import { describe, expect, it } from "vitest";
import type { GraphTask, TaskGraph, TaskStatus } from "../src/api/types";
import { buildGraphIndex, GraphDataError, projectRoot, tracePrerequisites } from "../src/features/task-graph/model";

const id = (letter: string): string => `00000000-0000-0000-0000-${letter.charCodeAt(0).toString(16).padStart(12, "0")}`;
const [A, B, C, D, E, F, G, H, I] = ["A", "B", "C", "D", "E", "F", "G", "H", "I"].map(id) as [string, string, string, string, string, string, string, string, string];
const time = "2026-10-20T00:00:00.123456Z";
type Seed = { readonly id: string; readonly status?: TaskStatus; readonly dependsOn?: readonly string[] };
const graph = (seeds: readonly Seed[]): TaskGraph => {
  const tasks: GraphTask[] = seeds.map((seed) => {
    const dependsOn = seed.dependsOn ?? [];
    const status = seed.status ?? "todo";
    const blockedBy = dependsOn.filter((predecessor) => seeds.find((item) => item.id === predecessor)?.status !== "done");
    return { startedAt: null, completedAt: null,
      id: seed.id, status, dependsOn, blockedBy, ready: status === "todo" && blockedBy.length === 0,
      titlePreview: "Private task text", titleTruncated: false, createdAt: time, updatedAt: time,
    };
  });
  const todo = tasks.filter((task) => task.status === "todo");
  return { observedAt: "2026-10-20T12:00:00Z",
    project: { id: id("P"), name: "Private project", repoUrl: "git@github.com:owner/repo.git", createdAt: time, updatedAt: time },
    tasks,
    summary: {
      total: tasks.length, proposed: tasks.filter((task) => task.status === "proposed").length, todo: todo.length, inProgress: tasks.filter((task) => task.status === "in_progress").length,
      done: tasks.filter((task) => task.status === "done").length,
      ready: todo.filter((task) => task.ready).length, blocked: todo.filter((task) => !task.ready).length,
    },
  };
};

const changedTask = (input: TaskGraph, taskId: string, change: Partial<GraphTask>): TaskGraph => ({
  ...input, tasks: input.tasks.map((task) => task.id === taskId ? { ...task, ...change } : task),
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
};

const expectRejected = (input: unknown): void => {
  expect(() => buildGraphIndex(input as TaskGraph)).toThrow(GraphDataError);
  expect(() => buildGraphIndex(input as TaskGraph)).not.toThrow("Private");
};

describe("graph indexing", () => {
  it("indexes an empty snapshot without inventing roots or progress", () => {
    const index = buildGraphIndex(graph([]));
    expect(index.nodes.size).toBe(0);
    expect(index.successors.size).toBe(0);
    expect(index.roots).toEqual([]);
    expect(index.sharedIds.size).toBe(0);
    expect(index.rootProgress.size).toBe(0);
    expect(() => projectRoot(index, A)).toThrow(GraphDataError);
  });

  it("preserves exact backend root order and snapshots independently", () => {
    const input = graph([{ id: C }, { id: A }, { id: B }]);
    const sameMillisecond = changedTask(changedTask(changedTask(input, C, { createdAt: "2026-10-20T00:00:00.123456Z" }), A,
      { createdAt: "2026-10-20T00:00:00.123455Z" }), B, { createdAt: "2026-10-20T00:00:00.123454Z" });
    const index = buildGraphIndex(sameMillisecond);
    expect(index.roots).toEqual([C, A, B]);
    expect([...index.nodes.keys()]).toEqual([C, A, B]);
    const later = buildGraphIndex(graph([{ id: C, status: "done" }]));
    expect(later.rootProgress.get(C)).toEqual({ total: 1, done: 1, status: "done" });
    expect(index.rootProgress.get(C)).toEqual({ total: 1, done: 0, status: "todo" });
  });

  it.each([
    { root: "proposed", child: "proposed", done: 0, status: "proposed" },
    { root: "proposed", child: "todo", done: 0, status: "todo" },
    { root: "todo", child: "proposed", done: 0, status: "todo" },
    { root: "in_progress", child: "proposed", done: 0, status: "in_progress" },
    { root: "done", child: "proposed", done: 1, status: "in_progress" },
    { root: "todo", child: "todo", done: 0, status: "todo" },
    { root: "in_progress", child: "todo", done: 0, status: "in_progress" },
    { root: "done", child: "todo", done: 1, status: "in_progress" },
    { root: "done", child: "done", done: 2, status: "done" },
  ] as const)("derives chain status $status from root $root and child $child", ({ root, child, done, status }) => {
    const index = buildGraphIndex(graph([{ id: A, status: root }, { id: B, status: child, dependsOn: [A] }]));
    expect(index.rootProgress.get(A)).toEqual({ total: 2, done, status });
  });

  it("deduplicates diamond reachability and keeps a finished root's unfinished chain in progress", () => {
    const index = buildGraphIndex(graph([
      { id: A, status: "done" }, { id: B, status: "done", dependsOn: [A] },
      { id: C, status: "done", dependsOn: [A] }, { id: D, dependsOn: [B, C] },
    ]));
    expect(index.roots).toEqual([A]);
    expect(index.successors.get(A)).toEqual([B, C]);
    expect(index.successors.get(D)).toEqual([]);
    expect(index.rootProgress.get(A)).toEqual({ total: 4, done: 3, status: "in_progress" });
    expect(index.sharedIds.size).toBe(0);
    const projection = projectRoot(index, A);
    expect(projection.mainIds).toEqual(new Set([A, B, C, D]));
    expect(projection.externalIds.size).toBe(0);
    expect(projection.completed).toBe(3);
    expect(projection.edges).toHaveLength(4);
    expect(projection.edges.every((edge) => !edge.external)).toBe(true);
    expect(new Set(projection.edges.map((edge) => `${edge.source}:${edge.target}`)).size).toBe(4);
  });

  it("retains proposed readiness and prerequisite details independently of todo counters", () => {
    const input = graph([
      { id: A, status: "proposed" }, { id: B, status: "proposed", dependsOn: [A] },
      { id: C, status: "todo", dependsOn: [A] }, { id: D, status: "done" },
      { id: E, status: "proposed", dependsOn: [D] },
    ]);
    const index = buildGraphIndex(input);
    expect(input.summary).toEqual({ total: 5, proposed: 3, todo: 1, inProgress: 0, done: 1, ready: 0, blocked: 1 });
    expect(index.nodes.get(A)).toMatchObject({ ready: false, blockedBy: [] });
    expect(index.nodes.get(B)).toMatchObject({ ready: false, blockedBy: [A] });
    expect(index.nodes.get(E)).toMatchObject({ ready: false, blockedBy: [] });
  });

  it("marks nodes reached from at least two of three roots and caches each root progress", () => {
    const index = buildGraphIndex(graph([
      { id: A, status: "done" }, { id: B, status: "done" }, { id: C, status: "done" },
      { id: D, status: "done", dependsOn: [A, B] }, { id: E, dependsOn: [D, C] }, { id: F, dependsOn: [E] },
      { id: G, status: "in_progress" },
    ]));
    expect(index.roots).toEqual([A, B, C, G]);
    expect(index.sharedIds).toEqual(new Set([D, E, F]));
    expect([...index.rootProgress]).toEqual([
      [A, { total: 4, done: 2, status: "in_progress" }], [B, { total: 4, done: 2, status: "in_progress" }],
      [C, { total: 3, done: 1, status: "in_progress" }], [G, { total: 1, done: 0, status: "in_progress" }],
    ]);
    const projection = projectRoot(index, A);
    expect(projection.mainIds).toEqual(new Set([A, D, E, F]));
    expect(projection.externalIds).toEqual(new Set([B, C]));
    expect(projection.completed).toBe(2);
  });

  it("counts independent and all-done chains correctly", () => {
    const index = buildGraphIndex(graph([
      { id: A, status: "done" }, { id: B, status: "done", dependsOn: [A] },
      { id: C }, { id: D, status: "in_progress" },
    ]));
    expect(projectRoot(index, A).completed).toBe(2);
    expect(index.rootProgress.get(A)).toEqual({ total: 2, done: 2, status: "done" });
    expect(projectRoot(index, C)).toMatchObject({ rootId: C, mainIds: new Set([C]), externalIds: new Set(), edges: [], completed: 0 });
    expect(index.rootProgress.get(C)).toEqual({ total: 1, done: 0, status: "todo" });
    expect(index.rootProgress.get(D)).toEqual({ total: 1, done: 0, status: "in_progress" });
  });

  it("accepts unordered blocked sets and preserves the immutable input", () => {
    const input = changedTask(graph([{ id: A }, { id: B }, { id: C, dependsOn: [A, B] }]), C, { blockedBy: [B, A] });
    const original = structuredClone(input);
    const index = buildGraphIndex(deepFreeze(input));
    const first = projectRoot(index, A);
    const second = projectRoot(index, A);
    expect(first).toEqual(second);
    expect(first.mainIds).not.toBe(second.mainIds);
    expect(input).toEqual(original);
    expect(index.nodes.get(A)).toBe(input.tasks[0]);
  });

  it("handles a long permitted chain iteratively", () => {
    const seeds = Array.from({ length: 1000 }, (_, position) => ({
      id: `00000000-0000-0000-0000-${position.toString(16).padStart(12, "0")}`,
      ...(position === 0 ? {} : { dependsOn: [`00000000-0000-0000-0000-${(position - 1).toString(16).padStart(12, "0")}`] }),
    }));
    const index = buildGraphIndex(graph(seeds));
    expect(projectRoot(index, seeds[0]!.id).mainIds.size).toBe(1000);
    expect(index.rootProgress.get(seeds[0]!.id)).toEqual({ total: 1000, done: 0, status: "todo" });
  });
});

describe("complete prerequisite projection", () => {
  it("keeps an all-proposed chain proposed with external todo context and deduplicates its shared successor", () => {
    const index = buildGraphIndex(graph([
      { id: A, status: "proposed" }, { id: B, status: "todo" },
      { id: C, status: "proposed", dependsOn: [A, B] }, { id: D, status: "proposed", dependsOn: [A, C] },
      { id: E, status: "todo", dependsOn: [B] },
    ]));
    const projection = projectRoot(index, A);
    expect(projection.mainIds).toEqual(new Set([A, C, D]));
    expect(projection.externalIds).toEqual(new Set([B]));
    expect(index.rootProgress.get(A)).toEqual({ total: 3, done: 0, status: "proposed" });
    expect(index.rootProgress.get(B)).toEqual({ total: 4, done: 0, status: "todo" });
    expect(index.sharedIds).toEqual(new Set([C, D]));
  });
  it("includes recursive external prerequisites without unrelated successors or external progress", () => {
    const index = buildGraphIndex(graph([
      { id: A, status: "done" }, { id: B }, { id: C, status: "done" },
      { id: D, status: "done", dependsOn: [A] }, { id: E, dependsOn: [B] }, { id: F, status: "done", dependsOn: [C] },
      { id: G, dependsOn: [D, E, F] }, { id: H, dependsOn: [G] }, { id: I, dependsOn: [E] },
    ]));
    const projection = projectRoot(index, A);
    expect(projection.mainIds).toEqual(new Set([A, D, G, H]));
    expect(projection.externalIds).toEqual(new Set([B, C, E, F]));
    expect(projection.mainIds.has(B)).toBe(false);
    expect(projection.externalIds.has(B)).toBe(true);
    expect(projection.externalIds.has(C)).toBe(true);
    expect(projection.externalIds.has(I)).toBe(false);
    expect(projection.completed).toBe(2);
    expect(index.rootProgress.get(A)).toEqual({ total: 4, done: 2, status: "in_progress" });
    expect(projection.edges).toEqual(expect.arrayContaining([
      { source: A, target: D, external: false }, { source: D, target: G, external: false },
      { source: E, target: G, external: true }, { source: F, target: G, external: true },
      { source: G, target: H, external: false },
      { source: B, target: E, external: true }, { source: C, target: F, external: true },
    ]));
    expect(projection.edges).toHaveLength(7);
    expect(projection.edges.every((edge) => projection.mainIds.has(edge.target) || projection.externalIds.has(edge.target))).toBe(true);
    expect(index.nodes.get(E)?.blockedBy).toEqual([B]);
  });

  it("keeps A→D and B→C→D complete while excluding C→X", () => {
    const X = id("X");
    const input = graph([
      { id: D, dependsOn: [A, C] }, { id: B }, { id: C, dependsOn: [B] },
      { id: A }, { id: X, dependsOn: [C] },
    ]);
    const index = buildGraphIndex(input);
    const projection = projectRoot(index, A);
    expect(projection.mainIds).toEqual(new Set([A, D]));
    expect([...projection.externalIds]).toEqual([B, C]);
    expect(projection.edges).toEqual([
      { source: A, target: D, external: false }, { source: C, target: D, external: true },
      { source: B, target: C, external: true },
    ]);
    expect(index.rootProgress.get(A)).toEqual({ total: 2, done: 0, status: "todo" });
    expect(input.tasks.map((task) => task.id)).toEqual([D, B, C, A, X]);
  });

  it("deduplicates completed shared ancestors and follows deep external chains iteratively", () => {
    const ancestors = Array.from({ length: 996 }, (_, position) => ({
      id: `external-${position}`, status: "done" as const,
      dependsOn: position === 0 ? [] : [`external-${position - 1}`],
    }));
    const index = buildGraphIndex(graph([
      { id: A }, ...ancestors,
      { id: B, status: "done", dependsOn: [ancestors.at(-1)!.id] },
      { id: C, status: "done", dependsOn: [ancestors.at(-1)!.id] },
      { id: D, dependsOn: [A, B, C] },
    ]));
    const projection = projectRoot(index, A);
    expect(projection.mainIds).toEqual(new Set([A, D]));
    expect(projection.externalIds.size).toBe(998);
    expect(projection.edges).toHaveLength(1000);
    expect(projection.completed).toBe(0);
    expect(index.rootProgress.get(A)).toEqual({ total: 2, done: 0, status: "todo" });
    expect(index.sharedIds).toEqual(new Set([D]));
    expect(projection.edges.filter((edge) => edge.external)).toHaveLength(999);
  });

  it("shows a shared successor once per root while maintaining a unique project index", () => {
    const index = buildGraphIndex(graph([{ id: A }, { id: B }, { id: C, dependsOn: [A, B] }]));
    expect(projectRoot(index, A).mainIds).toEqual(new Set([A, C]));
    expect(projectRoot(index, B).mainIds).toEqual(new Set([B, C]));
    expect(projectRoot(index, A).externalIds).toEqual(new Set([B]));
    expect(projectRoot(index, B).externalIds).toEqual(new Set([A]));
    expect(index.nodes.size).toBe(3);
  });

  it.each(["done", "in_progress"] as const)("excludes an external %s prerequisite from a chain's status", (status) => {
    const index = buildGraphIndex(graph([{ id: A }, { id: B, status }, { id: C, dependsOn: [A, B] }]));
    expect(projectRoot(index, A).externalIds).toEqual(new Set([B]));
    expect(index.sharedIds).toEqual(new Set([C]));
    expect(index.rootProgress.get(A)).toEqual({ total: 2, done: 0, status: "todo" });
    expect(index.rootProgress.get(B)).toEqual({ total: 2, done: status === "done" ? 1 : 0, status: "in_progress" });
  });

  it("rejects missing nodes and non-root tasks without returning a partial projection", () => {
    const index = buildGraphIndex(graph([{ id: A }, { id: B, dependsOn: [A] }]));
    expect(() => projectRoot(index, B)).toThrow(GraphDataError);
    expect(() => projectRoot(index, C)).toThrow(GraphDataError);
  });
});

describe("complete prerequisite inspection", () => {
  it("deduplicates shared completed and proposed prerequisites without following successors", () => {
    const input = deepFreeze(graph([
      { id: A, status: "done" }, { id: B, status: "done", dependsOn: [A] },
      { id: C, status: "proposed", dependsOn: [A] }, { id: D, dependsOn: [B, C] },
      { id: E, dependsOn: [A] }, { id: F, dependsOn: [D] },
    ]));
    const index = buildGraphIndex(input);
    expect(tracePrerequisites(index, D)).toEqual(new Set([D, B, C, A]));
    expect(tracePrerequisites(index, A)).toEqual(new Set([A]));
    expect(index.rootProgress.get(A)).toEqual({ total: 6, done: 2, status: "in_progress" });
    expect(input.tasks.find((task) => task.id === D)!.dependsOn).toEqual([B, C]);
  });

  it("traverses the full index iteratively even when nearly every ancestor is folded", () => {
    const seeds = Array.from({ length: 1000 }, (_, position) => ({
      id: `ancestor-${position}`, dependsOn: position === 0 ? [] : [`ancestor-${position - 1}`],
    }));
    const index = buildGraphIndex(graph(seeds));
    expect(tracePrerequisites(index, "ancestor-999")).toEqual(new Set(seeds.map((seed) => seed.id)));
    expect(tracePrerequisites(index, "ancestor-0")).toEqual(new Set(["ancestor-0"]));
  });

  it("returns independent inspection sets and rejects unknown selection identities", () => {
    const index = buildGraphIndex(graph([{ id: A }, { id: B, dependsOn: [A] }]));
    const first = tracePrerequisites(index, B);
    expect(tracePrerequisites(index, B)).not.toBe(first);
    expect(() => tracePrerequisites(index, C)).toThrow(GraphDataError);
  });
});

describe("invalid graph snapshots", () => {
  const valid = graph([{ id: A }, { id: B, dependsOn: [A] }]);

  it.each([
    null, undefined, [], { tasks: [] }, { tasks: [], summary: null }, { tasks: null, summary: {} },
    { ...valid, tasks: [null] }, { ...valid, tasks: [{ ...valid.tasks[0], id: null }] },
    { ...valid, tasks: [{ ...valid.tasks[0], id: "" }] },
    { ...valid, tasks: [...valid.tasks, valid.tasks[0]] },
    changedTask(valid, B, { dependsOn: [C], blockedBy: [C] }),
    changedTask(valid, B, { dependsOn: [B], blockedBy: [B] }),
    changedTask(valid, B, { dependsOn: [A, A] }),
    changedTask(valid, B, { blockedBy: [A, A] }),
    ...["dependsOn", "blockedBy", "status", "ready"].flatMap((field) => [undefined, null, 1].map((value) =>
      ({ ...valid, tasks: valid.tasks.map((task) => task.id === B ? { ...task, [field]: value } : task) }))),
    changedTask(valid, B, { status: "pending" as TaskStatus }),
    changedTask(valid, B, { blockedBy: [] }),
    changedTask(valid, A, { blockedBy: [C] }),
    changedTask(valid, B, { blockedBy: [C] }),
    changedTask(valid, B, { ready: true }),
    changedTask(valid, A, { ready: false }),
    graph([{ id: A }, { id: B, status: "in_progress", dependsOn: [A] }]),
    graph([{ id: A }, { id: B, status: "done", dependsOn: [A] }]),
    changedTask(graph([{ id: A, status: "done" }]), A, { ready: true }),
    changedTask(graph([{ id: A, status: "in_progress" }]), A, { ready: true }),
    changedTask(graph([{ id: A, status: "proposed" }]), A, { ready: true }),
    changedTask(graph([{ id: A }, { id: B, status: "proposed", dependsOn: [A] }]), B, { ready: true }),
    graph([{ id: A, dependsOn: [B] }, { id: B, dependsOn: [A] }]),
    graph([{ id: A }, { id: B, dependsOn: [C] }, { id: C, dependsOn: [D] }, { id: D, dependsOn: [B] }]),
    ...["total", "proposed", "todo", "inProgress", "done", "ready", "blocked"].flatMap((field) => [-1, 99, null, undefined, "0"].map((value) =>
      ({ ...valid, summary: { ...valid.summary, [field]: value } }))),
  ])("rejects incomplete or inconsistent input %# with a safe error", expectRejected);

  it("accepts exactly the edge limit and refuses oversized snapshots before projection", () => {
    const roots = Array.from({ length: 100 }, (_, position) => ({
      id: `10000000-0000-0000-0000-${position.toString(16).padStart(12, "0")}`,
    }));
    const leaves = Array.from({ length: 50 }, (_, position) => ({
      id: `20000000-0000-0000-0000-${position.toString(16).padStart(12, "0")}`,
      dependsOn: roots.map((root) => root.id),
    }));
    const index = buildGraphIndex(graph([...roots, ...leaves]));
    expect(index.nodes.size).toBe(150);
    expect(projectRoot(index, roots[0]!.id).edges).toHaveLength(5000);
    const oversized = graph([...roots, ...leaves, { id: A, dependsOn: [roots[0]!.id] }]);
    expect(() => buildGraphIndex(oversized)).toThrow("exceeds the supported size");
    expect(() => buildGraphIndex(graph(Array.from({ length: 1001 }, (_, position) => ({ id: String(position) }))))).toThrow("exceeds the supported size");
  });
});
