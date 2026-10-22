import type { CanvasPoint } from './layout';

export const DEPENDENCY_DASH_ARRAY = '5 4';
export const DEPENDENCY_DASH_PERIOD = 9;

type DashStart = { readonly startDistance: number };

export type DashPiece = DashStart & (
  | { readonly kind: 'line'; readonly from: CanvasPoint; readonly length: number; readonly cosine: number; readonly sine: number }
  | { readonly kind: 'path'; readonly points: readonly CanvasPoint[] }
);

type Segment = {
  readonly from: CanvasPoint;
  readonly to: CanvasPoint;
  readonly length: number;
  readonly start: number;
  readonly end: number;
};

const gapMiddle = 7;
const joinRoom = 12;
const minimumLine = 128;
// Bound GPU dash work even when a backend does not cull a rotated long stroke.
const maximumLine = 8192;
const nextGap = (distance: number): number => Math.ceil((distance - gapMiddle) / DEPENDENCY_DASH_PERIOD) * DEPENDENCY_DASH_PERIOD + gapMiddle;
const previousGap = (distance: number): number => Math.floor((distance - gapMiddle) / DEPENDENCY_DASH_PERIOD) * DEPENDENCY_DASH_PERIOD + gapMiddle;

const pointAt = (segment: Segment, distance: number): CanvasPoint => {
  if (distance === segment.start) return segment.from;
  if (distance === segment.end) return segment.to;
  const fraction = (distance - segment.start) / segment.length;
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * fraction,
    y: segment.from.y + (segment.to.y - segment.from.y) * fraction,
  };
};

// Local horizontal lines let Skia cull before expanding dashes, even after rotation:
// https://github.com/google/skia/blob/95ee33d7ec7791ab9c071675710a14fe6408ae4f/src/utils/SkDashPath.cpp#L117
// Native path pieces retain each bend; interior seams fall in the global dash gap.
export const decomposeDashedRoute = (points: readonly CanvasPoint[]): readonly DashPiece[] => {
  if (points.length < 2) return [];
  const segments: Segment[] = [];
  let cumulative = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length > 0) segments.push({ from, to, length, start: cumulative, end: cumulative + length });
    cumulative += length;
  }

  const pieces: DashPiece[] = [];
  let pending = [points[0]!];
  let pendingStart = 0;
  const flush = () => {
    if (pending.length > 1) pieces.push({ kind: 'path', points: pending, startDistance: pendingStart });
  };
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const start = index === 0 ? 0 : nextGap(segment.start + joinRoom);
    const end = index === segments.length - 1 ? segment.end : previousGap(segment.end - joinRoom);
    if (end - start >= minimumLine) {
      const from = pointAt(segment, start);
      const to = pointAt(segment, end);
      if (start > segment.start || pending.length > 1) {
        pending.push(from);
        flush();
      }
      for (let position = start; position < end;) {
        const limit = end - position <= maximumLine ? end : previousGap(position + maximumLine);
        pieces.push({
          kind: 'line', from: pointAt(segment, position), length: limit - position, startDistance: position,
          cosine: (segment.to.x - segment.from.x) / segment.length,
          sine: (segment.to.y - segment.from.y) / segment.length,
        });
        position = limit;
      }
      pending = [to];
      pendingStart = end;
      if (end < segment.end) pending.push(segment.to);
    } else pending.push(segment.to);
  }
  flush();
  return pieces;
};
