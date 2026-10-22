import { DEPENDENCY_DASH_PERIOD, type DashPiece } from './dashes';
import type { CanvasPoint } from './layout';

type Line = { readonly kind: 'line'; readonly from: CanvasPoint; readonly to: CanvasPoint };
type Quadratic = { readonly kind: 'quadratic'; readonly from: CanvasPoint; readonly control: CanvasPoint; readonly to: CanvasPoint };
type Segment = Line | Quadratic;

export type DependencyRoute = { readonly d: string; readonly pieces: readonly DashPiece[] };

const cornerRadius = 12;
const gapMiddle = 7;
const joinRoom = 12;
const minimumLine = 128;
const maximumZoom = 1.8;
const arcError = 0.025 / maximumZoom;
const distance = (from: CanvasPoint, to: CanvasPoint): number => Math.hypot(to.x - from.x, to.y - from.y);
const samePoint = (left: CanvasPoint, right: CanvasPoint): boolean => left.x === right.x && left.y === right.y;
const pointText = (point: CanvasPoint): string => `${point.x},${point.y}`;
const command = (segment: Segment): string => segment.kind === 'line'
  ? `L${pointText(segment.to)}`
  : `Q${pointText(segment.control)} ${pointText(segment.to)}`;
const midpoint = (from: CanvasPoint, to: CanvasPoint): CanvasPoint => ({ x: from.x + (to.x - from.x) / 2, y: from.y + (to.y - from.y) / 2 });
const nextGap = (length: number): number => Math.ceil((length - gapMiddle) / DEPENDENCY_DASH_PERIOD) * DEPENDENCY_DASH_PERIOD + gapMiddle;
const previousGap = (length: number): number => Math.floor((length - gapMiddle) / DEPENDENCY_DASH_PERIOD) * DEPENDENCY_DASH_PERIOD + gapMiddle;

const direction = (from: CanvasPoint, to: CanvasPoint): CanvasPoint => {
  const length = distance(from, to);
  if (!Number.isFinite(length) || length === 0) throw new Error('Task dependency route has invalid segment geometry.');
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};
const collinear = (from: CanvasPoint, corner: CanvasPoint, to: CanvasPoint): boolean => {
  const incoming = direction(from, corner);
  const outgoing = direction(corner, to);
  return incoming.x * outgoing.y === incoming.y * outgoing.x;
};

const normalize = (points: readonly CanvasPoint[]): readonly CanvasPoint[] => {
  const normalized: CanvasPoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Task dependency route has non-finite geometry.');
    if (normalized.length > 0 && samePoint(normalized.at(-1)!, point)) continue;
    while (normalized.length > 1) {
      const before = normalized.at(-2)!;
      const previous = normalized.at(-1)!;
      if (!collinear(before, previous, point)) break;
      const incoming = direction(before, previous);
      const outgoing = direction(previous, point);
      if (incoming.x * outgoing.x + incoming.y * outgoing.y <= 0) break;
      normalized.pop();
    }
    normalized.push(point);
  }
  if (normalized.length < 2) throw new Error('Task dependency route requires two distinct points.');
  return normalized;
};

const roundedSegments = (points: readonly CanvasPoint[]): readonly Segment[] => {
  const segments: Segment[] = [];
  let current = points[0]!;
  const appendLine = (to: CanvasPoint) => {
    if (!samePoint(current, to)) {
      direction(current, to);
      segments.push({ kind: 'line', from: current, to });
    }
    current = to;
  };
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1]!;
    const corner = points[index]!;
    const after = points[index + 1]!;
    if (collinear(before, corner, after)) {
      appendLine(corner);
      continue;
    }
    const incoming = direction(before, corner);
    const outgoing = direction(corner, after);
    const trim = Math.min(cornerRadius, distance(before, corner) / 2, distance(corner, after) / 2);
    const from = { x: corner.x - incoming.x * trim, y: corner.y - incoming.y * trim };
    const to = { x: corner.x + outgoing.x * trim, y: corner.y + outgoing.y * trim };
    appendLine(from);
    segments.push({ kind: 'quadratic', from, control: corner, to });
    current = to;
  }
  appendLine(points.at(-1)!);
  return segments;
};

// A quadratic's chord bounds its length below; its control polygon bounds it above.
// De Casteljau subdivision preserves both bounds. Halving the error allowance at
// each split bounds the sum for every curve, and sharing it across all curves
// bounds the route's accumulated dash-phase error to 0.025 CSS px at maximum zoom.
const quadraticLength = ({ from, control, to }: Quadratic, error: number): number => {
  const chord = distance(from, to);
  const polygon = distance(from, control) + distance(control, to);
  if (polygon - chord <= error * 2) return (polygon + chord) / 2;
  const left = midpoint(from, control);
  const right = midpoint(control, to);
  const middle = midpoint(left, right);
  return quadraticLength({ kind: 'quadratic', from, control: left, to: middle }, error / 2)
    + quadraticLength({ kind: 'quadratic', from: middle, control: right, to }, error / 2);
};

const pointOnLine = ({ from, to }: Line, length: number, requested: number): CanvasPoint => {
  if (requested === 0) return from;
  if (requested === length) return to;
  const fraction = requested / length;
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
};

// Local horizontal lines let Skia cull before expanding dashes, even after rotation:
// https://github.com/google/skia/blob/95ee33d7ec7791ab9c071675710a14fe6408ae4f/src/utils/SkDashPath.cpp#L117
// Short native paths share the canonical quadratics; all interior seams lie in
// global dash gaps so splitting adds no visible stroke caps or phase resets.
const dashedPieces = (segments: readonly Segment[]): readonly DashPiece[] => {
  const curveCount = segments.filter((segment) => segment.kind === 'quadratic').length;
  const pieces: DashPiece[] = [];
  let cumulative = 0;
  let pending = [`M${pointText(segments[0]!.from)}`];
  let pendingStart = 0;
  const flush = () => {
    if (pending.length > 1) pieces.push({ kind: 'path', d: pending.join(' '), startDistance: pendingStart });
  };
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const length = segment.kind === 'line' ? distance(segment.from, segment.to) : quadraticLength(segment, arcError / curveCount);
    const endDistance = cumulative + length;
    if (!Number.isFinite(endDistance)) throw new Error('Task dependency route has non-finite arc length.');
    if (segment.kind === 'line') {
      const start = index === 0 ? cumulative : nextGap(cumulative + joinRoom);
      const end = index === segments.length - 1 ? endDistance : previousGap(endDistance - joinRoom);
      if (end - start >= minimumLine) {
        const from = pointOnLine(segment, length, start - cumulative);
        const to = pointOnLine(segment, length, end - cumulative);
        if (start > cumulative) pending.push(`L${pointText(from)}`);
        flush();
        pieces.push({ kind: 'line', from, length: end - start, cos: (segment.to.x - segment.from.x) / length, sin: (segment.to.y - segment.from.y) / length, startDistance: start });
        pending = [`M${pointText(to)}`];
        pendingStart = end;
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
  const segments = roundedSegments(normalize(points));
  return {
    d: [`M${pointText(segments[0]!.from)}`, ...segments.map(command)].join(' '),
    pieces: dashed ? dashedPieces(segments) : [],
  };
};
