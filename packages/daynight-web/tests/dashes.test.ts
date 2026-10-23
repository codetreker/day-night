import { describe, expect, it } from 'vitest';
import type { DashPiece } from '../src/features/task-graph/dashes';
import type { CanvasPoint } from '../src/features/task-graph/layout';
import { compileDependencyRoute } from '../src/features/task-graph/routes';
import { arcLength, at, distance, parseRoute, type Curve } from './route-geometry';

const pieceCurves = (piece: DashPiece): Curve[] => piece.kind === 'path' ? parseRoute(piece.d) : [{ kind: 'L', from: piece.from,
  to: { x: piece.from.x + piece.length * piece.cosine, y: piece.from.y + piece.length * piece.sine } }];
const expectPoint = (actual: CanvasPoint, expected: CanvasPoint) => {
  expect(actual.x).toBeCloseTo(expected.x, 7); expect(actual.y).toBeCloseTo(expected.y, 7);
};
const verify = (points: readonly CanvasPoint[]): readonly DashPiece[] => {
  const compiled = compileDependencyRoute(points, true);
  const route = parseRoute(compiled.d);
  let position = 0;
  let current = route[0]!.from;
  let covered = 0;
  for (const piece of compiled.pieces) {
    expect(Math.abs(piece.startDistance - covered) * 1.8).toBeLessThan(0.025);
    if (piece.startDistance > 0) expect(piece.startDistance % 9).toBeCloseTo(7, 7);
    for (const curve of pieceCurves(piece)) {
      const expected = route[position]!;
      expectPoint(curve.from, current);
      if (curve.kind === 'Q') {
        expect(expected.kind).toBe('Q'); expectPoint(curve.control!, expected.control!); expectPoint(curve.from, expected.from); expectPoint(curve.to, expected.to);
      } else {
        expect(expected.kind).toBe('L');
        for (const t of [0, 0.5, 1]) {
          const point = at(curve, t);
          expect(distance(expected.from, point) + distance(point, expected.to)).toBeCloseTo(distance(expected.from, expected.to), 7);
        }
        expect((curve.to.x - curve.from.x) * (expected.to.x - expected.from.x) + (curve.to.y - curve.from.y) * (expected.to.y - expected.from.y)).toBeGreaterThan(0);
      }
      covered += arcLength(curve); current = curve.to;
      if (distance(current, expected.to) < 1e-7) position++;
    }
    if (piece.kind === 'line') expect(Math.hypot(piece.cosine, piece.sine)).toBeCloseTo(1, 12);
  }
  expect(position).toBe(route.length); expectPoint(current, route.at(-1)!.to);
  expect(covered).toBeCloseTo(route.reduce((sum, curve) => sum + arcLength(curve), 0), 7);
  return compiled.pieces;
};

describe('canonical rounded dependency routes and native dashes', () => {
  it.each([
    [{ x: 10, y: 20 }, { x: 2010, y: 20 }], [{ x: 1000, y: 2000 }, { x: 1900, y: 3200 }],
    [{ x: 800, y: 500 }, { x: -400, y: -1100 }], [{ x: 12, y: 1000 }, { x: 12, y: -1000 }],
  ])('keeps a long straight body as one unit-scale local horizontal line (%j → %j)', (from, to) => {
    const pieces = verify([from, to]); expect(pieces).toHaveLength(1); expect(pieces[0]!.kind).toBe('line'); expect(pieces[0]!.startDistance).toBe(0);
    expect(compileDependencyRoute([from, to], false)).toEqual({ d: `M${from.x},${from.y} L${to.x},${to.y}`, pieces: [] });
  });
  it('rounds corners by 12 units and uses the same quadratic in solid and dashed geometry', () => {
    const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }];
    const solid = compileDependencyRoute(points, false);
    expect(solid.d).toBe('M0,0 L988,0 Q1000,0 1000,12 L1000,1000'); expect(solid.pieces).toEqual([]);
    expect(arcLength(parseRoute(solid.d)[1]!)).toBeCloseTo(12 + 6 * Math.SQRT2 * Math.asinh(1), 10);
    const pieces = verify(points); expect(pieces.filter((piece) => piece.kind === 'line')).toHaveLength(2); expect(pieces.at(-1)!.startDistance).toBe(1024);
  });
  it('limits short corners to half adjacent spans and retains complete short native routes', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 20, y: 6 }];
    const route = compileDependencyRoute(points, true);
    expect(route.d).toBe('M0,0 L7,0 Q10,0 10,3 Q10,6 13,6 L20,6'); expect(route.pieces).toEqual([{ kind: 'path', d: route.d, startDistance: 0 }]); verify(points);
    expect(compileDependencyRoute([{ x: 0, y: 0 }, { x: 127.99, y: 0 }], true).pieces[0]!.kind).toBe('path');
    expect(compileDependencyRoute([{ x: 0, y: 0 }, { x: 128, y: 0 }], true).pieces[0]!.kind).toBe('line');
  });
  it('handles oblique, almost reversing and subpixel corners without changing endpoint tangents', () => {
    const points = [{ x: 10, y: 20 }, { x: 40, y: 60 }, { x: 1040, y: 60 }, { x: 1040, y: -1940 }, { x: -960, y: -440 }];
    const route = parseRoute(compileDependencyRoute(points, true).d);
    expectPoint(route[0]!.to, { x: 32.8, y: 50.4 }); expectPoint(route[1]!.control!, points[1]!); expectPoint(route[1]!.to, { x: 52, y: 60 }); verify(points);
    verify([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 0.001 }, { x: 3000, y: 2000 }]);
    verify([{ x: 0, y: 0 }, { x: 1e-5, y: 0 }, { x: 1e-5, y: 1e-5 }, { x: 2e-5, y: 1e-5 }]);
  });
  it('removes duplicate and forward-collinear points without mutating inputs or losing reversals', () => {
    const points = Object.freeze([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 40 }, { x: 60, y: 80 }, { x: 90, y: 120 }].map((point) => Object.freeze(point)));
    const original = structuredClone(points); expect(compileDependencyRoute(points, true).d).toBe('M0,0 L90,120'); verify(points); expect(points).toEqual(original);
    const reversal = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 1000, y: 0 }]; expect(compileDependencyRoute(reversal, true).d).toBe('M0,0 L2000,0 L1000,0'); verify(reversal);
  });
  it('bounds accumulated phase across 240 corners and keeps all seams in the continuous 5/4 pattern', () => {
    const points = Array.from({ length: 241 }, (_, index) => ({ x: index * 240, y: index % 2 === 0 ? 0 : 300 }));
    const pieces = verify(points); expect(pieces.filter((piece) => piece.kind === 'line')).toHaveLength(240);
    let covered = 0;
    for (const piece of pieces) {
      if (covered > 0) expect(Math.min((covered % 9) - 5, 9 - covered % 9)).toBeGreaterThan(1.9);
      const length = pieceCurves(piece).reduce((sum, curve) => sum + arcLength(curve), 0);
      for (const local of [0.1, 2.5, 5.5, length - 0.1]) expect((local + piece.startDistance % 9) % 9).toBeCloseTo((local + piece.startDistance) % 9, 7);
      covered += length;
    }
  });
  it.each([
    [{ x: 0, y: 0 }, { x: 100000, y: 0 }],
    [{ x: 12000, y: 90000 }, { x: -48000, y: 10000 }],
  ])('bounds long straight paint pieces without omitting route geometry (%j → %j)', (from, to) => {
    const pieces = verify([from, to]);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.kind).toBe('line');
      if (piece.kind === 'line') expect(piece.length).toBeLessThanOrEqual(8192);
    }
  });
  it('preserves canonical rounded bends and a short final line across bounded gap seams', () => {
    const points = [
      { x: 0, y: 0 }, { x: 8192.01, y: 0 },
      { x: 8192.01, y: 20000 }, { x: -10000, y: 20000 },
    ];
    const pieces = verify(points);
    expect(pieces.some((piece) => piece.kind === 'path')).toBe(true);
    for (const piece of pieces) {
      if (piece.kind === 'line') expect(piece.length).toBeLessThanOrEqual(8192);
    }
    const straight = verify(points.slice(0, 2));
    expect(straight).toHaveLength(2);
    expect(straight[1]!.startDistance).toBe(8188);
    expect(straight[1]!.kind).toBe('line');
    if (straight[1]!.kind === 'line') expect(straight[1]!.length).toBeCloseTo(4.01);
    expect(verify([{ x: 0, y: 0 }, { x: 8192, y: 0 }])).toHaveLength(1);
  });
  it('retains 68 million units of diagonal geometry without a long native dashed path', () => {
    const pieces = verify([{ x: 0, y: 0 }, { x: 40_800_000, y: 54_400_000 }, { x: 40_800_100, y: 54_400_000 }]);
    expect(pieces[0]!.kind).toBe('line');
    for (const piece of pieces) if (piece.kind === 'path') expect(pieceCurves(piece).reduce((sum, curve) => sum + arcLength(curve), 0)).toBeLessThan(150);
  });
  it.each([
    [], [{ x: 0, y: 0 }], [{ x: 1, y: 2 }, { x: 1, y: 2 }], [{ x: 0, y: 0 }, { x: NaN, y: 0 }],
    [{ x: Infinity, y: 0 }, { x: 1, y: 2 }], [{ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }],
    [{ x: 0, y: 0 }, { x: Number.MAX_VALUE, y: 0 }, { x: 0, y: 0 }],
  ].map((points) => ({ points })))('rejects invalid geometry explicitly ($points)', ({ points }) => {
    expect(() => compileDependencyRoute(points, true)).toThrow(/Task dependency route/);
  });
});
