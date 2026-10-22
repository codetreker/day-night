import { describe, expect, it } from 'vitest';
import type { DashPiece } from '../src/features/task-graph/dashes';
import type { CanvasPoint } from '../src/features/task-graph/layout';
import { compileDependencyRoute } from '../src/features/task-graph/routes';

type TestSegment = { from: CanvasPoint; to: CanvasPoint; control?: CanvasPoint };
const distance = (from: CanvasPoint, to: CanvasPoint) => Math.hypot(to.x - from.x, to.y - from.y);
const expectPoint = (actual: CanvasPoint, expected: CanvasPoint, precision = 7) => {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
};
const parse = (d: string): TestSegment[] => {
  const tokens = d.match(/[MLQ]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!;
  let position = 0;
  const point = (): CanvasPoint => ({ x: Number(tokens[position++]), y: Number(tokens[position++]) });
  expect(tokens[position++]).toBe('M');
  let from = point();
  const segments: TestSegment[] = [];
  while (position < tokens.length) {
    const command = tokens[position++];
    expect(['L', 'Q']).toContain(command);
    const control = command === 'Q' ? point() : undefined;
    const to = point();
    segments.push(control === undefined ? { from, to } : { from, control, to });
    from = to;
  }
  return segments;
};
const at = ({ from, to, control }: TestSegment, t: number): CanvasPoint => control === undefined
  ? { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
  : { x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t * t * to.x, y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t * t * to.y };

// Composite Simpson integration uses the derivative directly, independently of
// the production chord/control-polygon length enclosure.
const length = ({ from, control, to }: TestSegment): number => {
  if (control === undefined) return distance(from, to);
  const speed = (t: number) => 2 * Math.hypot((1 - t) * (control.x - from.x) + t * (to.x - control.x), (1 - t) * (control.y - from.y) + t * (to.y - control.y));
  const steps = 1024;
  let sum = speed(0) + speed(1);
  for (let step = 1; step < steps; step++) sum += (step % 2 === 0 ? 2 : 4) * speed(step / steps);
  return sum / (3 * steps);
};
const pieceSegments = (piece: DashPiece): TestSegment[] => piece.kind === 'path' ? parse(piece.d) : [{
  from: piece.from,
  to: { x: piece.from.x + piece.length * piece.cos, y: piece.from.y + piece.length * piece.sin },
}];

const expectCompleteRoute = (points: readonly CanvasPoint[]): readonly DashPiece[] => {
  const route = compileDependencyRoute(points, true);
  const canonical = parse(route.d);
  const pieces = route.pieces;
  const reconstructed = pieces.flatMap(pieceSegments);
  let canonicalPosition = 0;
  let covered = 0;
  let current = canonical[0]!.from;
  for (const piece of pieces) {
    const segments = pieceSegments(piece);
    expect(Math.abs(piece.startDistance - covered) * 1.8).toBeLessThan(0.025);
    expectPoint(segments[0]!.from, current);
    if (piece.startDistance > 0) expect(piece.startDistance % 9).toBeCloseTo(7, 7);
    for (const segment of segments) {
      const expected = canonical[canonicalPosition]!;
      expectPoint(segment.from, current);
      if (segment.control !== undefined) {
        expectPoint(segment.control, expected.control!);
        expectPoint(segment.from, expected.from);
        expectPoint(segment.to, expected.to);
      } else {
        expect(expected.control).toBeUndefined();
        const total = distance(expected.from, expected.to);
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const point = at(segment, t);
          expect(distance(expected.from, point) + distance(point, expected.to)).toBeCloseTo(total, 7);
        }
        const tangent = { x: expected.to.x - expected.from.x, y: expected.to.y - expected.from.y };
        expect((segment.to.x - segment.from.x) * tangent.x + (segment.to.y - segment.from.y) * tangent.y).toBeGreaterThan(0);
      }
      covered += length(segment);
      current = segment.to;
      if (distance(current, expected.to) < 1e-7) canonicalPosition++;
    }
    if (piece.kind === 'line') {
      expect(piece.length).toBeCloseTo(length(segments[0]!), 7);
      expect(Math.hypot(piece.cos, piece.sin)).toBeCloseTo(1, 12);
    }
  }
  expect(canonicalPosition).toBe(canonical.length);
  expectPoint(current, canonical.at(-1)!.to);
  expect(covered).toBeCloseTo(canonical.reduce((sum, segment) => sum + length(segment), 0), 7);
  expect(reconstructed.filter((segment) => segment.control !== undefined)).toEqual(canonical.filter((segment) => segment.control !== undefined));
  return pieces;
};

describe('smooth dependency route compilation', () => {
  it.each([
    [{ x: 10, y: 20 }, { x: 2010, y: 20 }],
    [{ x: 1000, y: 2000 }, { x: 1900, y: 3200 }],
    [{ x: 800, y: 500 }, { x: -400, y: -1100 }],
    [{ x: 12, y: 1000 }, { x: 12, y: -1000 }],
  ])('preserves endpoints and compiles a long straight route to one local horizontal line (%j → %j)', (from, to) => {
    const pieces = expectCompleteRoute([from, to]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.kind).toBe('line');
    expect(pieces[0]!.startDistance).toBe(0);
    expect(compileDependencyRoute([from, to], false)).toEqual({ d: `M${from.x},${from.y} L${to.x},${to.y}`, pieces: [] });
  });

  it('rounds a right angle with a 12-unit trim, preserving endpoints and endpoint tangents', () => {
    const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }];
    const route = compileDependencyRoute(points, false);
    expect(route.d).toBe('M0,0 L988,0 Q1000,0 1000,12 L1000,1000');
    expect(route.pieces).toEqual([]);
    const pieces = expectCompleteRoute(points);
    expect(pieces.filter((piece) => piece.kind === 'line')).toHaveLength(2);
    expect(pieces.filter((piece) => piece.kind === 'path')).toHaveLength(1);
    const curveLength = 12 + 6 * Math.SQRT2 * Math.asinh(1);
    const last = pieces.at(-1)!;
    expect(last.startDistance).toBeCloseTo(1024, 7);
    const actualCurve = parse(route.d)[1]!;
    expect(length(actualCurve)).toBeCloseTo(curveLength, 10);
  });

  it('limits adjacent short corners to half their original segment lengths', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 20, y: 6 }];
    const route = compileDependencyRoute(points, true);
    expect(route.d).toBe('M0,0 L7,0 Q10,0 10,3 Q10,6 13,6 L20,6');
    expect(route.pieces).toEqual([{ kind: 'path', d: route.d, startDistance: 0 }]);
    expectCompleteRoute(points);
  });

  it('preserves oblique waypoints and uses the same canonical curves in native pieces', () => {
    const points = [{ x: 10, y: 20 }, { x: 40, y: 60 }, { x: 1040, y: 60 }, { x: 1040, y: -1940 }, { x: -960, y: -440 }];
    const route = parse(compileDependencyRoute(points, true).d);
    expectPoint(route[0]!.to, { x: 32.8, y: 50.4 });
    expectPoint(route[1]!.control!, { x: 40, y: 60 });
    expectPoint(route[1]!.to, { x: 52, y: 60 });
    const pieces = expectCompleteRoute(points);
    expect(pieces.filter((piece) => piece.kind === 'line')).toHaveLength(3);
  });

  it('removes duplicate and forward-collinear points without mutating inputs, retaining reversals', () => {
    const points = Object.freeze([
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 40 }, { x: 60, y: 80 }, { x: 60, y: 80 }, { x: 90, y: 120 },
    ].map((point) => Object.freeze(point)));
    const original = structuredClone(points);
    expect(compileDependencyRoute(points, true).d).toBe('M0,0 L90,120');
    expect(points).toEqual(original);
    expectCompleteRoute(points);
    const reversal = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 1000, y: 0 }];
    expect(compileDependencyRoute(reversal, true).d).toBe('M0,0 L2000,0 L1000,0');
    expectCompleteRoute(reversal);
  });

  it('retains short routes and sends only sufficiently long straight spans to local lines', () => {
    const short = [{ x: 0, y: 0 }, { x: 12, y: 15 }, { x: -3, y: 15 }, { x: -3, y: 12 }];
    expectCompleteRoute(short);
    expectCompleteRoute([{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 8 }, { x: 0, y: 8 }]);
    expect(compileDependencyRoute([{ x: 0, y: 0 }, { x: 127.99, y: 0 }], true).pieces[0]!.kind).toBe('path');
    expect(compileDependencyRoute([{ x: 0, y: 0 }, { x: 128, y: 0 }], true).pieces[0]!.kind).toBe('line');
  });

  it('keeps almost reversing and subpixel corners finite with continuous curve phase', () => {
    expectCompleteRoute([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 0.001 }, { x: 3000, y: 2000 }]);
    const tiny = [{ x: 0, y: 0 }, { x: 1e-5, y: 0 }, { x: 1e-5, y: 1e-5 }, { x: 2e-5, y: 1e-5 }];
    expectCompleteRoute(tiny);
    expect(compileDependencyRoute(tiny, true).pieces).toHaveLength(1);
  });

  it('bounds accumulated curve-phase error across many corners and retains every seam in a gap', () => {
    const points = Array.from({ length: 241 }, (_, index) => ({ x: index * 240, y: index % 2 === 0 ? 0 : 300 }));
    const pieces = expectCompleteRoute(points);
    expect(pieces.filter((piece) => piece.kind === 'line')).toHaveLength(240);
    let covered = 0;
    for (const piece of pieces) {
      const pieceLength = pieceSegments(piece).reduce((sum, segment) => sum + length(segment), 0);
      for (const local of [0.1, 2.5, 5.5, pieceLength - 0.1]) {
        expect((local + piece.startDistance % 9) % 9).toBeCloseTo((local + piece.startDistance) % 9, 7);
      }
      if (covered > 0) expect(Math.min((covered % 9) - 5, 9 - covered % 9)).toBeGreaterThan(1.9);
      covered += pieceLength;
    }
  });

  it('preserves a 68-million-unit diagonal body as a local horizontal line rather than a long native path', () => {
    const points = [{ x: 0, y: 0 }, { x: 40_800_000, y: 54_400_000 }, { x: 40_800_100, y: 54_400_000 }];
    const pieces = expectCompleteRoute(points);
    const long = pieces[0]!;
    expect(long.kind).toBe('line');
    if (long.kind === 'line') expect(long.length).toBeGreaterThan(67_999_900);
    for (const piece of pieces) if (piece.kind === 'path') expect(pieceSegments(piece).reduce((sum, segment) => sum + length(segment), 0)).toBeLessThan(150);
  });

  it.each([
    [], [{ x: 0, y: 0 }], [{ x: 1, y: 2 }, { x: 1, y: 2 }],
    [{ x: 0, y: 0 }, { x: NaN, y: 0 }], [{ x: Infinity, y: 0 }, { x: 1, y: 2 }],
    [{ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }],
    [{ x: 0, y: 0 }, { x: Number.MAX_VALUE, y: 0 }, { x: 0, y: 0 }],
  ].map((points) => ({ points })))('rejects invalid geometry rather than dropping its dependency ($points)', ({ points }) => {
    expect(() => compileDependencyRoute(points, true)).toThrow(/Task dependency route/);
  });
});
