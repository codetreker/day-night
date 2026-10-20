import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as installedEsm from '@dagrejs/dagre';
import type { EdgeLabel, Graph, GraphLabel, NodeLabel } from '@dagrejs/dagre';

type TestGraph = Graph<GraphLabel, NodeLabel, EdgeLabel>;
type SortResult = { vs: string[]; barycenter?: number; weight?: number; usedBias: boolean };
type Engine = Pick<typeof installedEsm, 'Graph' | 'layout'>;
type InstrumentedEngine = Engine & {
  sortSubgraphForRegression: (graph: TestGraph, root: string, constraints: TestGraph, oldNodes: null, biasRight: boolean) => SortResult;
};
type Direction = 'LR' | 'RL' | 'TB' | 'BT';
type Ranker = 'longest-path' | 'tight-tree' | 'network-simplex';
type Fixture = {
  name: string;
  nodes: readonly string[];
  edges: readonly (readonly [string, string])[];
  parents?: readonly (readonly [string, string])[];
  variableSize?: boolean;
};

const require = createRequire(import.meta.url);
const packageDirectory = dirname(dirname(fileURLToPath(import.meta.resolve('@dagrejs/dagre'))));
const patch = (await readFile(new URL('../../../patches/@dagrejs__dagre@3.1.1.patch', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const pristineHashes: Record<string, string> = {
  'dagre.esm.js': '93f5f23d1bee1217531900366798277689400850a5560f238d4f213c8d552a63',
  'dagre.cjs': '70b9a4367932dd436075d98892a7968d65cf66ae83263f995e0531823b59b671',
};

// The pristine engines are recovered from the pinned patch, avoiding a second
// durable copy of the dependency. Hashes identify the published 3.1.1 bundles.
// The two loops whose behavior must remain identical are owned by:
// https://github.com/dagrejs/dagre/blob/c3ed0802cd98de74c21cff1f754689ebbb0f8dae/lib/order/sort-subgraph.ts#L59-L94
// https://github.com/dagrejs/dagre/blob/c3ed0802cd98de74c21cff1f754689ebbb0f8dae/lib/position/bk.ts#L92-L145
const reversePinnedPatch = (filename: string, installed: string): string => {
  const section = patch.split(/^diff --git /m).find((part) => part.startsWith(`a/dist/${filename} b/dist/${filename}\n`));
  assert.notEqual(section, undefined, `Missing patch section for ${filename}`);
  const lines = section!.split('\n');
  const hunks = lines.filter((line) => line.startsWith('@@'));
  assert.equal(hunks.length, 1, 'The pinned bundle patch must cover one complete file.');
  const counts = /^@@ -1,(\d+) \+1,(\d+) @@/.exec(hunks[0]!);
  assert.notEqual(counts, null, 'The pinned bundle patch must start at its first line.');
  const body = lines.slice(lines.indexOf(hunks[0]!) + 1);
  const before = body.filter((line) => line.startsWith('-') || line.startsWith(' ')).map((line) => line.slice(1));
  const after = body.filter((line) => line.startsWith('+') || line.startsWith(' ')).map((line) => line.slice(1));
  assert.equal(before.length, Number(counts![1]));
  assert.equal(after.length, Number(counts![2]));
  assert.equal(`${after.join('\n')}\n`, installed, 'Installed runtime must match the committed patch.');
  const original = `${before.join('\n')}\n`;
  assert.equal(createHash('sha256').update(original).digest('hex'), pristineHashes[filename]);
  return original;
};

const withoutSourceMap = (source: string): string => source.replace(/^\/\/# sourceMappingURL=.*(?:\n|$)/gm, '');

const sortSubgraphName = (source: string): string => {
  const marker = source.lastIndexOf('"usedBias"');
  assert.notEqual(marker, -1, 'Pinned sort-subgraph marker is missing.');
  const start = source.lastIndexOf('function ', marker);
  const match = /^function ([\w$]+)\(/.exec(source.slice(start));
  assert.notEqual(match, null, 'Pinned sort-subgraph declaration is missing.');
  return match![1]!;
};

const loadEsm = async (source: string): Promise<InstrumentedEngine> => {
  const code = `${withoutSourceMap(source)}\nexport { ${sortSubgraphName(source)} as sortSubgraphForRegression };\n`;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as Promise<InstrumentedEngine>;
};

const loadCjs = (source: string): InstrumentedEngine => {
  const module = { exports: {} };
  const code = `${withoutSourceMap(source)}\nmodule.exports.sortSubgraphForRegression = ${sortSubgraphName(source)};\n`;
  new Function('module', 'exports', 'require', code)(module, module.exports, createRequire(resolve(packageDirectory, 'dist/dagre.cjs')));
  return module.exports as InstrumentedEngine;
};

const patchedEsmSource = await readFile(resolve(packageDirectory, 'dist/dagre.esm.js'), 'utf8');
const patchedCjsSource = await readFile(resolve(packageDirectory, 'dist/dagre.cjs'), 'utf8');
const originalEsmSource = reversePinnedPatch('dagre.esm.js', patchedEsmSource);
const originalCjsSource = reversePinnedPatch('dagre.cjs', patchedCjsSource);
const originalEsm = await loadEsm(originalEsmSource);
const originalCjs = loadCjs(originalCjsSource);
const patchedEsm = await loadEsm(patchedEsmSource);
const patchedCjs = loadCjs(patchedCjsSource);
const installedCjs = require('@dagrejs/dagre') as Engine;

const build = (engine: Engine, fixture: Fixture, direction: Direction, ranker: Ranker): TestGraph => {
  const graph = new engine.Graph<GraphLabel, NodeLabel, EdgeLabel>({ directed: true, multigraph: true, compound: fixture.parents !== undefined });
  graph.setGraph({ rankdir: direction, ranker, nodesep: 32, ranksep: 64, marginx: 32, marginy: 32 });
  fixture.nodes.forEach((id, index) => graph.setNode(id, {
    width: fixture.variableSize ? 120 + index % 4 * 40 : 220,
    height: fixture.variableSize ? 60 + index % 3 * 24 : 96,
  }));
  fixture.parents?.forEach(([child, parent]) => graph.setParent(child, parent));
  fixture.edges.forEach(([source, target], index) => graph.setEdge(source, target, { weight: 1, minlen: 1 }, `edge-${index}`));
  return graph;
};

const geometry = (graph: TestGraph) => ({
  width: graph.graph().width,
  height: graph.graph().height,
  nodes: graph.nodes().sort().map((id) => {
    const node = graph.node(id);
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), `Non-finite node ${id}`);
    return { id, x: node.x, y: node.y, width: node.width, height: node.height };
  }),
  edges: graph.edges().map((edge) => {
    const label = graph.edge(edge);
    assert.ok(label.points !== undefined && label.points.length > 0, `Missing edge points ${edge.name}`);
    assert.ok(label.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
    return { source: edge.v, target: edge.w, name: edge.name, points: label.points };
  }).sort((left, right) => left.name! < right.name! ? -1 : left.name! > right.name! ? 1 : 0),
});

const layout = (engine: Engine, fixture: Fixture, direction: Direction, ranker: Ranker) => {
  const graph = build(engine, fixture, direction, ranker);
  engine.layout(graph);
  assert.ok(graph.graph().width! > 0 && graph.graph().height! > 0);
  return geometry(graph);
};

const fixtures: Fixture[] = [
  { name: 'single', nodes: ['a'], edges: [] },
  { name: 'chain', nodes: ['a', 'b', 'c', 'd'], edges: [['a', 'b'], ['b', 'c'], ['c', 'd']] },
  { name: 'diamond', nodes: ['a', 'b', 'c', 'd'], edges: [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']] },
  { name: 'equal barycenters', nodes: ['a', 'b', 'c', 'd', 'e', 'f'], edges: [['a', 'c'], ['b', 'c'], ['a', 'd'], ['b', 'd'], ['c', 'e'], ['d', 'e'], ['c', 'f'], ['d', 'f']] },
  { name: 'disconnected', nodes: ['a', 'b', 'c', 'd', 'e'], edges: [['a', 'b'], ['c', 'd']] },
  { name: 'long edges and sizes', nodes: ['a', 'b', 'c', 'd', 'e'], edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['a', 'e'], ['b', 'e']], variableSize: true },
  { name: 'parallel edges', nodes: ['a', 'b', 'c'], edges: [['a', 'b'], ['a', 'b'], ['a', 'b'], ['b', 'c']] },
  { name: 'reversed pair', nodes: ['a', 'b', 'c'], edges: [['a', 'b'], ['b', 'a'], ['a', 'c'], ['b', 'c']] },
  { name: 'reverse insertion', nodes: ['c', 'b', 'a'], edges: [['b', 'a'], ['a', 'b'], ['b', 'c'], ['a', 'c']] },
  { name: 'compound borders', nodes: ['left', 'right', 'a', 'b', 'c', 'd'], parents: [['a', 'left'], ['b', 'left'], ['c', 'right'], ['d', 'right']], edges: [['a', 'b'], ['b', 'c'], ['c', 'd']] },
  { name: 'nested borders', nodes: ['outer', 'inner', 'a', 'b', 'c'], parents: [['inner', 'outer'], ['a', 'inner'], ['b', 'inner'], ['c', 'outer']], edges: [['a', 'b'], ['b', 'c']] },
];

for (let seed = 1; seed <= 12; seed++) {
  let state = seed;
  const random = (): number => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
  const nodes = Array.from({ length: 8 + seed }, (_, index) => `node-${index}`);
  const edges: [string, string][] = [];
  for (let source = 0; source < nodes.length; source++) for (let target = source + 1; target < nodes.length; target++) {
    if (random() < 0.2) edges.push([nodes[source]!, nodes[target]!]);
  }
  fixtures.push({ name: `seeded DAG ${seed}`, nodes, edges, variableSize: true });
}

test('both installed public exports preserve pristine geometry and deterministic layout', () => {
  for (const fixture of fixtures) for (const direction of ['LR', 'RL', 'TB', 'BT'] as const) {
    for (const ranker of ['longest-path', 'tight-tree', 'network-simplex'] as const) {
      const expected = layout(originalEsm, fixture, direction, ranker);
      assert.deepEqual(layout(originalCjs, fixture, direction, ranker), expected, `${fixture.name}: pristine CJS`);
      assert.deepEqual(layout(installedEsm, fixture, direction, ranker), expected, `${fixture.name}: installed ESM`);
      assert.deepEqual(layout(installedCjs, fixture, direction, ranker), expected, `${fixture.name}: installed CJS`);
      assert.deepEqual(layout(installedEsm, fixture, direction, ranker), expected, `${fixture.name}: repeated ESM`);
    }
  }
});

test('equal-barycenter bucketing preserves bias and reversed-pair insertion behavior', () => {
  type Entry = { id: string; center?: number; reversed?: boolean; endpoints?: readonly [string, string] };
  const cases: { name: string; entries: Entry[]; usedBias: boolean }[] = [
    { name: 'truthy equal regular nodes', entries: [{ id: 'a', center: 1 }, { id: 'b', center: 1 }], usedBias: true },
    { name: 'zero and absent centers', entries: [{ id: 'a', center: 0 }, { id: 'b', center: 0 }, { id: 'isolated' }], usedBias: false },
    { name: 'first reversed', entries: [{ id: 'reverse', center: 1, reversed: true, endpoints: ['p', 'q'] }, { id: 'forward', center: 1, reversed: false, endpoints: ['p', 'q'] }], usedBias: false },
    { name: 'second removed', entries: [{ id: 'forward', center: 1, reversed: false, endpoints: ['p', 'q'] }, { id: 'reverse', center: 1, reversed: true, endpoints: ['p', 'q'] }], usedBias: false },
    { name: 'interleaved buckets', entries: [{ id: 'a', center: 1, reversed: true, endpoints: ['p', 'q'] }, { id: 'b', center: 2, reversed: false, endpoints: ['r', 's'] }, { id: 'c', center: 1, reversed: false, endpoints: ['p', 'q'] }, { id: 'd', center: 2, reversed: true, endpoints: ['r', 's'] }], usedBias: false },
    { name: 'bias after pair removal', entries: [{ id: 'a', center: 1, reversed: false, endpoints: ['p', 'q'] }, { id: 'b', center: 1 }, { id: 'c', center: 1, reversed: true, endpoints: ['p', 'q'] }], usedBias: true },
  ];
  const run = (engine: InstrumentedEngine, entries: Entry[], biasRight: boolean) => {
    const graph = new engine.Graph<GraphLabel, NodeLabel, EdgeLabel>({ directed: true, compound: true });
    graph.setGraph({});
    graph.setNode('root', { width: 0, height: 0 });
    for (const entry of entries) {
      graph.setNode(entry.id, { width: 1, height: 1, ...(entry.endpoints === undefined ? {} : { dummy: 'edge', edgeObj: { v: entry.endpoints[0], w: entry.endpoints[1] }, edgeLabel: { reversed: entry.reversed === true } }) });
      graph.setParent(entry.id, 'root');
      if (entry.center !== undefined) {
        const predecessor = `predecessor-${entry.id}`;
        graph.setNode(predecessor, { width: 1, height: 1, order: entry.center });
        graph.setEdge(predecessor, entry.id, { weight: 1 });
      }
    }
    const result = engine.sortSubgraphForRegression(graph, 'root', new engine.Graph<GraphLabel, NodeLabel, EdgeLabel>(), null, biasRight);
    return { vs: result.vs, barycenter: result.barycenter, weight: result.weight, usedBias: result.usedBias };
  };
  for (const fixture of cases) for (const entries of [fixture.entries, [...fixture.entries].reverse()]) for (const biasRight of [false, true]) {
    const expected = run(originalEsm, entries, biasRight);
    assert.equal(expected.usedBias, fixture.usedBias, fixture.name);
    assert.equal(expected.vs.length, entries.length, `${fixture.name}: every entry remains`);
    assert.deepEqual(run(originalCjs, entries, biasRight), expected, fixture.name);
    assert.deepEqual(run(patchedEsm, entries, biasRight), expected, fixture.name);
    assert.deepEqual(run(patchedCjs, entries, biasRight), expected, fixture.name);
  }
});

test('patched exports retain linked licenses and do not advertise stale source maps', async () => {
  for (const [filename, source] of [['dagre.esm.js', patchedEsmSource], ['dagre.cjs', patchedCjsSource]] as const) {
    assert.ok(source.includes(`For license information please see ${filename}.LEGAL.txt`));
    assert.ok(!source.includes('sourceMappingURL='));
    const license = await readFile(resolve(packageDirectory, `dist/${filename}.LEGAL.txt`), 'utf8');
    assert.match(license, /Permission is hereby granted/);
  }
});
