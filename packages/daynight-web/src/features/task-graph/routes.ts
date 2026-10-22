import { DEPENDENCY_DASH_PERIOD, type DashPiece } from './dashes';
import type { CanvasPoint } from './layout';

type Line = { readonly kind: 'line'; readonly from: CanvasPoint; readonly to: CanvasPoint };
type Quadratic = { readonly kind: 'quadratic'; readonly from: CanvasPoint; readonly control: CanvasPoint; readonly to: CanvasPoint };
type Segment = Line | Quadratic;
export type DependencyRoute = { readonly d: string; readonly pieces: readonly DashPiece[] };

export const DEPENDENCY_CORNER_RADIUS = 12;
const gapMiddle = 7;
const joinRoom = 12;
const minimumLine = 128;
const arcError = 0.025 / 1.8;
const distance = (from: CanvasPoint, to: CanvasPoint): number => Math.hypot(to.x - from.x, to.y - from.y);
const samePoint = (first: CanvasPoint, second: CanvasPoint): boolean => first.x === second.x && first.y === second.y;
const coordinates = (point: CanvasPoint): string => `${point.x},${point.y}`;
const command = (segment: Segment): string => segment.kind === 'line' ? `L${coordinates(segment.to)}` : `Q${coordinates(segment.control)} ${coordinates(segment.to)}`;
const middle = (from: CanvasPoint, to: CanvasPoint): CanvasPoint => ({ x: from.x + (to.x - from.x) / 2, y: from.y + (to.y - from.y) / 2 });
const nextGap = (value: number): number => Math.ceil((value - gapMiddle) / DEPENDENCY_DASH_PERIOD) * DEPENDENCY_DASH_PERIOD + gapMiddle;
const previousGap = (value: number): number => Math.floor((value - gapMiddle) / DEPENDENCY_DASH_PERIOD) * DEPENDENCY_DASH_PERIOD + gapMiddle;

const direction = (from: CanvasPoint, to: CanvasPoint): CanvasPoint => {
  const length = distance(from, to);
  if (!Number.isFinite(length) || length === 0) throw new Error('Task dependency route has invalid segment geometry.');
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};
const straight = (before: CanvasPoint, corner: CanvasPoint, after: CanvasPoint): boolean => {
  const incoming = direction(before, corner);
  const outgoing = direction(corner, after);
  return incoming.x * outgoing.y === incoming.y * outgoing.x;
};
const normalize = (points: readonly CanvasPoint[]): readonly CanvasPoint[] => {
  const result: CanvasPoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Task dependency route has non-finite geometry.');
    if (result.length > 0 && samePoint(result.at(-1)!, point)) continue;
    while (result.length > 1) {
      const before = result.at(-2)!;
      const corner = result.at(-1)!;
      if (!straight(before, corner, point)) break;
      const incoming = direction(before, corner);
      const outgoing = direction(corner, point);
      if (incoming.x * outgoing.x + incoming.y * outgoing.y <= 0) break;
      result.pop();
    }
    result.push(point);
  }
  if (result.length < 2) throw new Error('Task dependency route requires two distinct points.');
  return result;
};
const round = (points: readonly CanvasPoint[]): readonly Segment[] => {
  const segments: Segment[] = [];
  let current = points[0]!;
  const lineTo = (to: CanvasPoint) => {
    if (!samePoint(current, to)) {
      direction(current, to);
      segments.push({ kind: 'line', from: current, to });
    }
    current = to;
  };
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1]!; const control = points[index]!; const after = points[index + 1]!;
    if (straight(before, control, after)) { lineTo(control); continue; }
    const incoming = direction(before, control); const outgoing = direction(control, after);
    const trim = Math.min(DEPENDENCY_CORNER_RADIUS, distance(before, control) / 2, distance(control, after) / 2);
    const from = { x: control.x - incoming.x * trim, y: control.y - incoming.y * trim };
    const to = { x: control.x + outgoing.x * trim, y: control.y + outgoing.y * trim };
    lineTo(from);
    segments.push({ kind: 'quadratic', from, control, to });
    current = to;
  }
  lineTo(points.at(-1)!);
  return segments;
};

// Chord and control-polygon lengths enclose a quadratic's true length. De
// Casteljau subdivision and split error allowances preserve the enclosure;
// allocating it across every curve bounds cumulative phase error to 0.025 CSS px
// at the maximum 1.8 zoom. Solid routes do not need arc-length calculations.
const quadraticLength = ({ from, control, to }: Quadratic, error: number): number => {
  const lower = distance(from, to);
  const upper = distance(from, control) + distance(control, to);
  if (upper - lower <= error * 2) return (lower + upper) / 2;
  const left = middle(from, control); const right = middle(control, to); const center = middle(left, right);
  return quadraticLength({ kind: 'quadratic', from, control: left, to: center }, error / 2)
    + quadraticLength({ kind: 'quadratic', from: center, control: right, to }, error / 2);
};
const onLine = ({ from, to }: Line, length: number, value: number): CanvasPoint => {
  if (value === 0) return from;
  if (value === length) return to;
  const fraction = value / length;
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
};

// Local horizontal lines retain Skia's dash culling through their unit-scale
// rotation. Short path pieces share the canonical quadratics; every interior cut
// lies at a global dash-gap midpoint, preserving phase without visible caps:
// https://github.com/google/skia/blob/95ee33d7ec7791ab9c071675710a14fe6408ae4f/src/utils/SkDashPath.cpp#L117
const dashedPieces = (segments: readonly Segment[]): readonly DashPiece[] => {
  const curves = segments.filter((segment) => segment.kind === 'quadratic').length;
  const pieces: DashPiece[] = [];
  let cumulative = 0;
  let pending = [`M${coordinates(segments[0]!.from)}`];
  let pendingStart = 0;
  const flush = () => {
    if (pending.length > 1) pieces.push({ kind: 'path', d: pending.join(' '), startDistance: pendingStart });
  };
  for (const [index, segment] of segments.entries()) {
    const length = segment.kind === 'line' ? distance(segment.from, segment.to) : quadraticLength(segment, arcError / curves);
    const endDistance = cumulative + length;
    if (!Number.isFinite(endDistance)) throw new Error('Task dependency route has non-finite arc length.');
    if (segment.kind === 'line') {
      const start = index === 0 ? cumulative : nextGap(cumulative + joinRoom);
      const end = index === segments.length - 1 ? endDistance : previousGap(endDistance - joinRoom);
      if (end - start >= minimumLine) {
        const from = onLine(segment, length, start - cumulative);
        const to = onLine(segment, length, end - cumulative);
        if (start > cumulative) pending.push(`L${coordinates(from)}`);
        flush();
        pieces.push({ kind: 'line', from, length: end - start, cosine: (segment.to.x - segment.from.x) / length, sine: (segment.to.y - segment.from.y) / length, startDistance: start });
        pending = [`M${coordinates(to)}`]; pendingStart = end;
        if (end < endDistance) pending.push(command(segment));
        cumulative = endDistance;
        continue;
      }
    }
    pending.push(command(segment));
    cumulative = endDistance;
  }
  flush();
  return pieces;
};

export const compileDependencyRoute = (points: readonly CanvasPoint[], dashed: boolean): DependencyRoute => {
  const segments = round(normalize(points));
  return { d: [`M${coordinates(segments[0]!.from)}`, ...segments.map(command)].join(' '), pieces: dashed ? dashedPieces(segments) : [] };
};
