import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePerformance } from './performance.mts';

const report = () => ({ schemaVersion: 1, result: 'passed', datasets: [
  { scenario: 'capacity-chain', nodes: 1000, edges: 999 },
  { scenario: 'capacity-merge', nodes: 1000, edges: 5000 },
  { scenario: 'capacity-shared', nodes: 1000, edges: 5000 },
  { scenario: 'capacity-external', nodes: 1000, edges: 5000 },
].map((dataset) => ({ ...dataset, networkMs: 1, result: 'passed', visibility: Array.from({ length: 5 }, (_, repetition) => ({ repetition, overviewNodes: 50, overviewEdges: 100, addedNodes: 20, addedEdges: 120, expandedNodes: 70, expandedEdges: 220, resetNodes: 50, resetEdges: 100 })), measurements: Array.from({ length: 5 }, () => ({
  openMs: 3000, detailMs: 300, detailNetworkMs: 1, zoomMs: 300, panMs: 300, layoutMs: 10, renderMs: 20,
})) })), limits: {
  node: { status: 409, nodeCount: 1001, edgeCount: 0, maxNodes: 1000, maxEdges: 5000 },
  edge: { status: 409, nodeCount: 1000, edgeCount: 5001, maxNodes: 1000, maxEdges: 5000 },
} });
test('accepts all five measurements at the supported performance boundaries', () => validatePerformance(report()));
test('rejects absent, partial, mislabeled, slow, and invalid capacity receipts', () => {
  for (const mutate of [
    (value: ReturnType<typeof report>) => { value.result = 'failed'; },
    (value: ReturnType<typeof report>) => { value.datasets.pop(); },
    (value: ReturnType<typeof report>) => { value.datasets[1]!.scenario = 'capacity-chain'; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.nodes = 999; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.measurements.pop(); },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.measurements[0]!.openMs = 3000.01; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.measurements[0]!.detailMs = 300.01; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.networkMs = NaN; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.measurements[0]!.detailNetworkMs = -1; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.measurements[0]!.layoutMs = -1; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.measurements[0]!.renderMs = NaN; },
    (value: ReturnType<typeof report>) => { value.limits.edge.edgeCount = 5000; },
    (value: ReturnType<typeof report>) => { value.limits.node.status = 200; },
  ]) { const value = report(); mutate(value); assert.throws(() => validatePerformance(value)); }
  for (const value of [undefined, {}, { schemaVersion: 1, result: 'passed' }]) assert.throws(() => validatePerformance(value));
});

test('requires complete ordered visibility evidence even when all timed interactions pass', () => {
  for (const mutate of [
    (value: ReturnType<typeof report>) => { delete (value.datasets[0] as { visibility?: unknown }).visibility; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility.pop(); },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility.push({ ...value.datasets[0]!.visibility[0]! }); },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility[1]!.repetition = 0; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility[0]!.overviewNodes = 51; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility[0]!.overviewEdges = 101; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility[0]!.addedNodes = 0; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility[0]!.addedNodes = 21; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility[0]!.expandedNodes = 69; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility[0]!.expandedEdges = 219; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility[0]!.resetNodes = 49; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility[0]!.resetEdges = 99; },
    (value: ReturnType<typeof report>) => { value.datasets[0]!.visibility[0]!.addedEdges = NaN; },
  ]) { const value = report(); mutate(value); assert.throws(() => validatePerformance(value)); }
});
