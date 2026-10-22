import { describe, expect, it } from 'vitest';
import { decomposeDashedRoute, type DashPiece } from '../src/features/task-graph/dashes';
import type { CanvasPoint } from '../src/features/task-graph/layout';

const distance = (from: CanvasPoint, to: CanvasPoint) => Math.hypot(to.x - from.x, to.y - from.y);
const vertices = (piece: DashPiece): readonly CanvasPoint[] => piece.kind === 'path' ? piece.points : [
  piece.from,
  { x: piece.from.x + piece.length * piece.cosine, y: piece.from.y + piece.length * piece.sine },
];
const routeLength = (points: readonly CanvasPoint[]) => points.slice(1).reduce((total, point, index) => total + distance(points[index]!, point), 0);
const expectPoint = (actual: CanvasPoint, expected: CanvasPoint) => {
  expect(actual.x).toBeCloseTo(expected.x, 7);
  expect(actual.y).toBeCloseTo(expected.y, 7);
};
const atDistance = (points: readonly CanvasPoint[], requested: number): CanvasPoint => {
  let remaining = requested;
  for (let position = 1; position < points.length; position++) {
    const from = points[position - 1]!;
    const to = points[position]!;
    const length = distance(from, to);
    if (length === 0) continue;
    if (remaining <= length) return {
      x: from.x + (to.x - from.x) * remaining / length,
      y: from.y + (to.y - from.y) * remaining / length,
    };
    remaining -= length;
  }
  return points.at(-1)!;
};

const expectCompleteRoute = (points: readonly CanvasPoint[]): readonly DashPiece[] => {
  const pieces = decomposeDashedRoute(points);
  const total = routeLength(points);
  let covered = 0;
  for (const piece of pieces) {
    const actual = vertices(piece);
    expect(piece.startDistance).toBeCloseTo(covered, 7);
    expect(actual.length).toBeGreaterThanOrEqual(2);
    expect(actual.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expectPoint(actual[0]!, atDistance(points, covered));
    const length = routeLength(actual);
    expect(length).toBeGreaterThan(0);
    if (piece.kind === 'line') {
      expect(piece.length).toBeCloseTo(length, 7);
      expect(Math.hypot(piece.cosine, piece.sine)).toBeCloseTo(1, 12);
    }
    for (let position = 1; position < actual.length; position++) {
      const from = actual[position - 1]!;
      const to = actual[position]!;
      const step = distance(from, to);
      expectPoint({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, atDistance(points, covered + step / 2));
      covered += step;
      expectPoint(to, atDistance(points, covered));
    }
    if (piece.startDistance > 0) expect(piece.startDistance % 9).toBeCloseTo(7, 7);
    if (covered < total - 1e-7) expect(covered % 9).toBeCloseTo(7, 7);
  }
  expect(covered).toBeCloseTo(total, 7);
  return pieces;
};

describe('dashed dependency route decomposition', () => {
  it.each([
    [{ x: 10, y: 20 }, { x: 2010, y: 20 }],
    [{ x: 1000, y: 2000 }, { x: 1900, y: 3200 }],
    [{ x: 800, y: 500 }, { x: -400, y: -1100 }],
    [{ x: 12, y: 1000 }, { x: 12, y: -1000 }],
  ])('encodes a complete long straight route as one local horizontal line (%j → %j)', (from, to) => {
    const pieces = expectCompleteRoute([from, to]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.kind).toBe('line');
    expect(pieces[0]!.startDistance).toBe(0);
    if (pieces[0]!.kind === 'line') {
      expect(pieces[0]!.length).toBeCloseTo(distance(from, to));
      expectPoint(pieces[0]!.from, from);
    }
  });

  it('covers every segment once and keeps original bends inside native path pieces', () => {
    const points = [
      { x: 0, y: 0 }, { x: 17, y: 19 }, { x: 1017, y: 19 },
      { x: 1034, y: 38 }, { x: 1034, y: 2038 }, { x: -966, y: 538 },
    ];
    const pieces = expectCompleteRoute(points);
    expect(pieces.some((piece) => piece.kind === 'line')).toBe(true);
    for (const corner of points.slice(1, -1)) {
      const join = pieces.find((piece) => piece.kind === 'path' && piece.points.some((point) => point.x === corner.x && point.y === corner.y));
      expect(join?.kind).toBe('path');
      if (join?.kind === 'path') {
        const position = join.points.findIndex((point) => point.x === corner.x && point.y === corner.y);
        expect(position).toBeGreaterThan(0);
        expect(position).toBeLessThan(join.points.length - 1);
      }
    }
  });

  it('places seams in unpainted gaps and preserves dash occupancy on both sides', () => {
    const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 2000, y: 1000 }];
    const pieces = expectCompleteRoute(points);
    expect(pieces.filter((piece) => piece.kind === 'line')).toHaveLength(3);
    for (const piece of pieces) {
      const length = routeLength(vertices(piece));
      for (const local of [0, 0.25, Math.min(length / 2, 4.5), length - 0.25, length]) {
        const localPhase = (local + piece.startDistance % 9) % 9;
        const globalPhase = (local + piece.startDistance) % 9;
        expect(localPhase < 5).toBe(globalPhase < 5);
        expect(localPhase).toBeCloseTo(globalPhase, 7);
      }
      if (piece.startDistance > 0) {
        expect(piece.startDistance % 9).toBeGreaterThan(5);
        expect(piece.startDistance % 9).toBeLessThan(9);
      }
    }
  });

  it.each([
    [{ x: 0, y: 0 }, { x: 100000, y: 0 }],
    [{ x: 12000, y: 90000 }, { x: -48000, y: 10000 }],
  ])('bounds long straight paint pieces without omitting route geometry (%j → %j)', (from, to) => {
    const pieces = expectCompleteRoute([from, to]);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.kind).toBe('line');
      if (piece.kind === 'line') expect(piece.length).toBeLessThanOrEqual(8192);
    }
  });

  it('preserves native bends and a short final line across bounded gap seams', () => {
    const points = [
      { x: 0, y: 0 }, { x: 8192.01, y: 0 },
      { x: 8192.01, y: 20000 }, { x: -10000, y: 20000 },
    ];
    const pieces = expectCompleteRoute(points);
    expect(pieces.some((piece) => piece.kind === 'path')).toBe(true);
    for (const piece of pieces) {
      if (piece.kind === 'line') expect(piece.length).toBeLessThanOrEqual(8192);
    }
    const straight = expectCompleteRoute(points.slice(0, 2));
    expect(straight).toHaveLength(2);
    expect(straight[1]!.startDistance).toBe(8188);
    expect(straight[1]!.kind).toBe('line');
    if (straight[1]!.kind === 'line') expect(straight[1]!.length).toBeCloseTo(4.01);
    expect(expectCompleteRoute([{ x: 0, y: 0 }, { x: 8192, y: 0 }])).toHaveLength(1);
  });

  it('retains short routes, short reversals, and short segments between long bodies', () => {
    const short = [{ x: 0, y: 0 }, { x: 12, y: 15 }, { x: -3, y: 15 }, { x: -3, y: 12 }];
    const pieces = expectCompleteRoute(short);
    expect(pieces).toEqual([{ kind: 'path', points: short, startDistance: 0 }]);
    expectCompleteRoute([{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 8 }, { x: 0, y: 8 }]);
    expect(decomposeDashedRoute([{ x: 0, y: 0 }, { x: 127.99, y: 0 }])[0]!.kind).toBe('path');
    expect(decomposeDashedRoute([{ x: 0, y: 0 }, { x: 128, y: 0 }])[0]!.kind).toBe('line');
  });

  it('ignores zero-length segments without losing route coverage or changing inputs', () => {
    const points = Object.freeze([
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 0 },
      { x: 1000, y: 2000 }, { x: 1000, y: 2000 },
    ].map((point) => Object.freeze(point)));
    const original = structuredClone(points);
    const pieces = expectCompleteRoute(points);
    expect(points).toEqual(original);
    expect(decomposeDashedRoute(points)).toEqual(pieces);
    expect(decomposeDashedRoute([])).toEqual([]);
    expect(decomposeDashedRoute([{ x: 1, y: 2 }])).toEqual([]);
    expect(decomposeDashedRoute([{ x: 1, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 2 }])).toEqual([]);
  });
});
