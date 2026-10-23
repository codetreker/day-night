import { describe, expect, it } from "vitest";
import type { GraphTask, TaskGraph, TaskStatus } from "../src/api/types";
import { buildGroupIndex, GraphDataError, projectGroup, tracePrerequisites } from "../src/features/task-graph/model";

const id = (letter: string): string => `00000000-0000-0000-0000-${letter.charCodeAt(0).toString(16).padStart(12, "0")}`;
const [A, B, C, D, E, F, G, H, I] = ["A", "B", "C", "D", "E", "F", "G", "H", "I"].map(id) as [string, string, string, string, string, string, string, string, string];
const time = "2026-10-20T00:00:00.123456Z";
type Seed = { readonly id: string; readonly groupId?: string; readonly status?: TaskStatus; readonly dependsOn?: readonly string[] };
const graph = (seeds: readonly Seed[]): TaskGraph => {
  const tasks: GraphTask[] = seeds.map((seed) => {
    const dependsOn = seed.dependsOn ?? [];
    const status = seed.status ?? "todo";
    const blockedBy = dependsOn.filter((predecessor) => seeds.find((item) => item.id === predecessor)?.status !== "done");
    return {
      id: seed.id, groupId: seed.groupId ?? seed.id, status, dependsOn, blockedBy, ready: status === "todo" && blockedBy.length === 0,
      titlePreview: "Private task text", titleTruncated: false, createdAt: time, updatedAt: time,
    };
  });
  const todo = tasks.filter((task) => task.status === "todo");
  return {
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
  expect(() => buildGroupIndex(input as TaskGraph)).toThrow(GraphDataError);
  expect(() => buildGroupIndex(input as TaskGraph)).not.toThrow("Private");
};

describe("explicit group indexing", () => {
  it("indexes an empty snapshot without inventing groups", () => {
    const index = buildGroupIndex(graph([]));
    expect(index.nodes.size).toBe(0);
    expect(index.successors.size).toBe(0);
    expect(index.groupIds).toEqual([]);
    expect(index.groupMembers.size).toBe(0);
    expect(index.groupProgress.size).toBe(0);
    expect(() => projectGroup(index, A)).toThrow(GraphDataError);
  });

  it("preserves exact backend leader order and snapshots independently", () => {
    const input = graph([{ id: C }, { id: A }, { id: B }]);
    const exact = changedTask(changedTask(changedTask(input, C, { createdAt: "2026-10-20T00:00:00.123456Z" }), A,
      { createdAt: "2026-10-20T00:00:00.123455Z" }), B, { createdAt: "2026-10-20T00:00:00.123454Z" });
    const index = buildGroupIndex(exact);
    expect(index.groupIds).toEqual([C, A, B]);
    expect([...index.nodes.keys()]).toEqual([C, A, B]);
    const later = buildGroupIndex(graph([{ id: C, status: "done" }]));
    expect(later.groupProgress.get(C)).toEqual({ total: 1, done: 1, status: "done" });
    expect(index.groupProgress.get(C)).toEqual({ total: 1, done: 0, status: "todo" });
  });

  it.each([
    { leader: "proposed", member: "proposed", done: 0, status: "proposed" },
    { leader: "proposed", member: "todo", done: 0, status: "todo" },
    { leader: "todo", member: "proposed", done: 0, status: "todo" },
    { leader: "in_progress", member: "proposed", done: 0, status: "in_progress" },
    { leader: "done", member: "proposed", done: 1, status: "in_progress" },
    { leader: "todo", member: "todo", done: 0, status: "todo" },
    { leader: "in_progress", member: "todo", done: 0, status: "in_progress" },
    { leader: "done", member: "todo", done: 1, status: "in_progress" },
    { leader: "done", member: "done", done: 2, status: "done" },
  ] as const)("derives $status from leader $leader and disconnected member $member", ({ leader, member, done, status }) => {
    const index = buildGroupIndex(graph([{ id: A, status: leader }, { id: B, groupId: A, status: member }]));
    expect(index.groupProgress.get(A)).toEqual({ total: 2, done, status });
  });

  it("groups disconnected members and leaders with prerequisites without absorbing cross-group successors", () => {
    const input = graph([
      { id: A, dependsOn: [B] }, { id: B }, { id: C, groupId: A },
      { id: D, dependsOn: [A] }, { id: E, groupId: A, dependsOn: [C, D] },
    ]);
    const index = buildGroupIndex(input);
    expect(index.groupIds).toEqual([A, B, D]);
    expect(index.groupMembers.get(A)).toEqual([A, C, E]);
    expect(index.groupMembers.get(D)).toEqual([D]);
    expect(index.groupProgress.get(A)).toEqual({ total: 3, done: 0, status: "todo" });
    const projection = projectGroup(index, A);
    expect(projection.mainIds).toEqual(new Set([A, C, E]));
    expect(projection.externalIds).toEqual(new Set([B, D]));
    expect(projection.edges).toEqual([
      { source: B, target: A, external: true }, { source: A, target: D, external: true },
      { source: C, target: E, external: false }, { source: D, target: E, external: true },
    ]);
    const changed = buildGroupIndex({ ...changedTask(input, E, { dependsOn: [], blockedBy: [], ready: true }), summary: { ...input.summary, ready: input.summary.ready + 1, blocked: input.summary.blocked - 1 } });
    expect(changed.groupIds).toEqual(index.groupIds);
    expect(changed.groupMembers).toEqual(index.groupMembers);
    expect(projectGroup(changed, A).externalIds).toEqual(new Set([B]));
  });

  it("moves membership only when groupId changes explicitly", () => {
    const input = graph([{ id: A }, { id: B }, { id: C, groupId: A, dependsOn: [A] }]);
    const index = buildGroupIndex(changedTask(input, C, { groupId: B }));
    expect(index.groupMembers.get(A)).toEqual([A]);
    expect(index.groupMembers.get(B)).toEqual([B, C]);
    expect(projectGroup(index, B).externalIds).toEqual(new Set([A]));
  });

  it("deduplicates diamond dependencies without changing exclusive membership", () => {
    const index = buildGroupIndex(graph([
      { id: A, status: "done" }, { id: B, groupId: A, status: "done", dependsOn: [A] },
      { id: C, groupId: A, status: "done", dependsOn: [A] }, { id: D, groupId: A, dependsOn: [B, C] },
    ]));
    expect(index.groupIds).toEqual([A]);
    expect(index.successors.get(A)).toEqual([B, C]);
    expect(index.groupProgress.get(A)).toEqual({ total: 4, done: 3, status: "in_progress" });
    expect(projectGroup(index, A).edges).toHaveLength(4);
    expect(projectGroup(index, A).completed).toBe(3);
  });

  it("accepts unordered blocked sets and preserves immutable input and independent projections", () => {
    const input = changedTask(graph([{ id: A }, { id: B }, { id: C, groupId: A, dependsOn: [A, B] }]), C, { blockedBy: [B, A] });
    const original = structuredClone(input);
    const index = buildGroupIndex(deepFreeze(input));
    const first = projectGroup(index, A);
    const second = projectGroup(index, A);
    expect(first).toEqual(second);
    expect(first.mainIds).not.toBe(second.mainIds);
    expect(input).toEqual(original);
    expect(index.nodes.get(A)).toBe(input.tasks[0]);
  });
});

describe("complete prerequisite projection and inspection", () => {
  it("includes recursive external prerequisites without unrelated successors or external progress", () => {
    const index = buildGroupIndex(graph([
      { id: A, status: "done" }, { id: B }, { id: C, status: "done" },
      { id: D, groupId: A, status: "done", dependsOn: [A] }, { id: E, dependsOn: [B] }, { id: F, status: "done", dependsOn: [C] },
      { id: G, groupId: A, dependsOn: [D, E, F] }, { id: H, groupId: A, dependsOn: [G] }, { id: I, dependsOn: [E] },
    ]));
    const projection = projectGroup(index, A);
    expect(projection.mainIds).toEqual(new Set([A, D, G, H]));
    expect(projection.externalIds).toEqual(new Set([B, C, E, F]));
    expect(projection.externalIds.has(I)).toBe(false);
    expect(projection.completed).toBe(2);
    expect(index.groupProgress.get(A)).toEqual({ total: 4, done: 2, status: "in_progress" });
    expect(projection.edges).toHaveLength(7);
    expect(tracePrerequisites(index, G)).toEqual(new Set([G, D, E, F, A, B, C]));
    expect(tracePrerequisites(index, A)).toEqual(new Set([A]));
    expect(tracePrerequisites(index, G)).not.toBe(tracePrerequisites(index, G));
    expect(() => tracePrerequisites(index, id("X"))).toThrow(GraphDataError);
  });

  it("keeps exclusive membership when another group depends on the same prerequisite", () => {
    const index = buildGroupIndex(graph([{ id: A }, { id: B }, { id: C, groupId: B, dependsOn: [A, B] }]));
    expect(projectGroup(index, A).mainIds).toEqual(new Set([A]));
    expect(projectGroup(index, A).externalIds.size).toBe(0);
    expect(projectGroup(index, B).mainIds).toEqual(new Set([B, C]));
    expect(projectGroup(index, B).externalIds).toEqual(new Set([A]));
    expect(index.nodes.size).toBe(3);
  });

  it.each(["done", "in_progress"] as const)("excludes an external %s prerequisite from group status", (status) => {
    const index = buildGroupIndex(graph([{ id: A }, { id: B, status }, { id: C, groupId: A, dependsOn: [A, B] }]));
    expect(projectGroup(index, A).externalIds).toEqual(new Set([B]));
    expect(index.groupProgress.get(A)).toEqual({ total: 2, done: 0, status: "todo" });
    expect(index.groupProgress.get(B)).toEqual({ total: 1, done: status === "done" ? 1 : 0, status });
  });

  it("handles deep external context and long groups iteratively", () => {
    const seeds = Array.from({ length: 1000 }, (_, position) => ({
      id: `task-${position}`, groupId: position < 998 ? `task-${position}` : "task-998",
      dependsOn: position === 0 ? [] : [`task-${position - 1}`],
    }));
    const index = buildGroupIndex(graph(seeds));
    const projection = projectGroup(index, "task-998");
    expect(projection.mainIds).toEqual(new Set(["task-998", "task-999"]));
    expect(projection.externalIds.size).toBe(998);
    expect(projection.edges).toHaveLength(999);
    expect(tracePrerequisites(index, "task-999")).toEqual(new Set(seeds.map((seed) => seed.id)));
    expect(() => projectGroup(index, "task-999")).toThrow(GraphDataError);
  });
});

describe("invalid graph snapshots", () => {
  const valid = graph([{ id: A }, { id: B, dependsOn: [A] }]);

  it.each([
    null, undefined, [], { tasks: [] }, { tasks: [], summary: null }, { tasks: null, summary: {} },
    { ...valid, tasks: [null] }, { ...valid, tasks: [{ ...valid.tasks[0], id: null }] },
    { ...valid, tasks: [{ ...valid.tasks[0], id: "" }] },
    { ...valid, tasks: [...valid.tasks, valid.tasks[0]] },
    changedTask(valid, B, { groupId: "" }),
    changedTask(valid, B, { groupId: C }),
    changedTask(changedTask(valid, A, { groupId: B }), B, { groupId: A }),
    changedTask(valid, B, { dependsOn: [C], blockedBy: [C] }),
    changedTask(valid, B, { dependsOn: [B], blockedBy: [B] }),
    changedTask(valid, B, { dependsOn: [A, A] }),
    changedTask(valid, B, { blockedBy: [A, A] }),
    ...["groupId", "dependsOn", "blockedBy", "status", "ready"].flatMap((field) => [undefined, null, 1].map((value) =>
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
      groupId: roots[0]!.id, dependsOn: roots.map((root) => root.id),
    }));
    const index = buildGroupIndex(graph([...roots, ...leaves]));
    expect(index.nodes.size).toBe(150);
    expect(projectGroup(index, roots[0]!.id).edges).toHaveLength(5000);
    const oversized = graph([...roots, ...leaves, { id: A, dependsOn: [roots[0]!.id] }]);
    expect(() => buildGroupIndex(oversized)).toThrow("exceeds the supported size");
    expect(() => buildGroupIndex(graph(Array.from({ length: 1001 }, (_, position) => ({ id: String(position) }))))).toThrow("exceeds the supported size");
  });
});
