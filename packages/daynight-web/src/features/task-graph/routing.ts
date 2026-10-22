import type { CanvasEdge, CanvasPoint } from './layout';
import { DEPENDENCY_CORNER_RADIUS } from './routes';

export type RoutingNode = {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};
type Interval = { readonly start: number; readonly end: number };
type Column = {
  readonly left: number;
  readonly right: number;
  readonly nodes: readonly RoutingNode[];
  readonly occupiedRows: readonly Interval[];
};
type LocatedNode = { readonly rectangle: RoutingNode; readonly column: number };

const passageClearance = DEPENDENCY_CORNER_RADIUS + 4;
const firstMatching = <Value,>(values: readonly Value[], predicate: (value: Value) => boolean): number => {
  let first = 0;
  let last = values.length;
  while (first < last) {
    const middle = Math.floor((first + last) / 2);
    if (predicate(values[middle]!)) last = middle;
    else first = middle + 1;
  }
  return first;
};
const midpoint = (left: number, right: number): number => left + (right - left) / 2;
const samePoint = (left: CanvasPoint, right: CanvasPoint): boolean => left.x === right.x && left.y === right.y;

const buildColumns = (nodes: readonly RoutingNode[]): readonly Column[] => {
  const groups = new Map<number, RoutingNode[]>();
  for (const node of nodes) {
    if (![node.left, node.right, node.top, node.bottom].every(Number.isFinite) || node.right <= node.left || node.bottom <= node.top) {
      throw new Error('Task dependency routing received invalid node bounds.');
    }
    const group = groups.get(node.left);
    if (group === undefined) groups.set(node.left, [node]);
    else group.push(node);
  }
  const columns = [...groups.values()].map((members): Column => {
    const sorted = members.sort((left, right) => left.top - right.top);
    const rows: { start: number; end: number }[] = [];
    for (const [index, node] of sorted.entries()) {
      if (node.right !== sorted[0]!.right || (index > 0 && node.top < sorted[index - 1]!.bottom)) {
        throw new Error('Task dependency routing requires nonoverlapping node columns.');
      }
      const start = node.top - passageClearance;
      const end = node.bottom + passageClearance;
      const previous = rows.at(-1);
      if (previous !== undefined && start < previous.end) previous.end = Math.max(previous.end, end);
      else rows.push({ start, end });
    }
    return { left: sorted[0]!.left, right: sorted[0]!.right, nodes: sorted, occupiedRows: rows };
  }).sort((left, right) => left.left - right.left);
  for (let index = 1; index < columns.length; index++) {
    if (columns[index]!.left - columns[index - 1]!.right < DEPENDENCY_CORNER_RADIUS * 2) {
      throw new Error('Task dependency routing requires room for rounded rank-gap channels.');
    }
  }
  return columns;
};

const freeRow = (column: Column, intended: number): number => {
  const index = firstMatching(column.occupiedRows, (interval) => interval.end > intended);
  const interval = column.occupiedRows[index];
  if (interval === undefined || intended <= interval.start) return intended;
  return intended - interval.start <= interval.end - intended ? interval.start : interval.end;
};

const entersRectangle = (from: CanvasPoint, to: CanvasPoint, rectangle: RoutingNode): boolean => {
  let first = 0;
  let last = 1;
  for (const [start, end, minimum, maximum] of [
    [from.x, to.x, rectangle.left - DEPENDENCY_CORNER_RADIUS, rectangle.right + DEPENDENCY_CORNER_RADIUS],
    [from.y, to.y, rectangle.top - DEPENDENCY_CORNER_RADIUS, rectangle.bottom + DEPENDENCY_CORNER_RADIUS],
  ] as const) {
    if (start === end) {
      if (start <= minimum || start >= maximum) return false;
    } else {
      const enter = (minimum - start) / (end - start);
      const leave = (maximum - start) / (end - start);
      first = Math.max(first, Math.min(enter, leave));
      last = Math.min(last, Math.max(enter, leave));
      if (first >= last) return false;
    }
  }
  return first < last;
};

const clearSpan = (columns: readonly Column[], from: CanvasPoint, to: CanvasPoint): boolean => {
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);
  const firstColumn = firstMatching(columns, (column) => column.right + DEPENDENCY_CORNER_RADIUS > from.x);
  for (let index = firstColumn; index < columns.length; index++) {
    const column = columns[index]!;
    if (column.left - DEPENDENCY_CORNER_RADIUS >= to.x) break;
    const firstNode = firstMatching(column.nodes, (node) => node.bottom + DEPENDENCY_CORNER_RADIUS > top);
    for (let position = firstNode; position < column.nodes.length; position++) {
      const node = column.nodes[position]!;
      if (node.top - DEPENDENCY_CORNER_RADIUS >= bottom) break;
      if (entersRectangle(from, to, node)) return false;
    }
  }
  return true;
};

const append = (points: CanvasPoint[], point: CanvasPoint) => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Task dependency routing produced non-finite geometry.');
  if (points.length > 0) {
    const previous = points.at(-1)!;
    if (point.x < previous.x) throw new Error('Task dependency routing cannot move backward between ranks.');
    if (samePoint(previous, point)) return;
  }
  while (points.length > 1) {
    const before = points.at(-2)!;
    const previous = points.at(-1)!;
    const ax = previous.x - before.x;
    const ay = previous.y - before.y;
    const bx = point.x - previous.x;
    const by = point.y - previous.y;
    if (ax * by !== ay * bx) break;
    if (ax * bx + ay * by < 0) throw new Error('Task dependency routing cannot reverse direction within a channel.');
    points.pop();
  }
  points.push(point);
};

const routeBlockedSpan = (columns: readonly Column[], from: CanvasPoint, to: CanvasPoint): readonly CanvasPoint[] => {
  const result: CanvasPoint[] = [from];
  const first = firstMatching(columns, (column) => column.right >= from.x);
  for (let index = first; index < columns.length; index++) {
    const column = columns[index]!;
    if (column.left > to.x) break;
    if (from.x >= column.left && from.x <= column.right) continue;
    const previous = columns[index - 1];
    if (previous === undefined) throw new Error('Task dependency routing has no channel before an intermediate column.');
    const channel = midpoint(previous.right, column.left);
    const intended = from.y + (to.y - from.y) * ((midpoint(column.left, column.right) - from.x) / (to.x - from.x));
    const row = to.x >= column.left && to.x <= column.right ? to.y : freeRow(column, intended);
    append(result, { x: channel, y: result.at(-1)!.y });
    append(result, { x: channel, y: row });
    append(result, { x: Math.min(column.right, to.x), y: row });
  }
  append(result, { x: to.x, y: result.at(-1)!.y });
  append(result, to);
  for (let index = 1; index < result.length; index++) {
    if (!clearSpan(columns, result[index - 1]!, result[index]!)) throw new Error('Task dependency routing could not establish a clear rank-gap channel.');
  }
  return result.slice(1);
};

// Dagre's rectangle clipping can leave steep boundary spans inside a card column:
// https://github.com/dagrejs/dagre/blob/c3ed0802cd98de74c21cff1f754689ebbb0f8dae/lib/layout.ts#L584-L601
// We own horizontal side ports and use its intermediate column rows as passage
// intent. Gap-only vertical detours carry no obstacle constraint. Clear interior
// diagonals remain intact; blocked spans use indexed free rows and gap midpoints.
// Testing spans against radius-expanded cards leaves room for every bounded
// quadratic corner, whose control triangle stays within that radius of a span.
export const planDependencyRoutes = (nodes: readonly RoutingNode[], edges: readonly CanvasEdge[]): readonly CanvasEdge[] => {
  const columns = buildColumns(nodes);
  const located = new Map<string, LocatedNode>();
  for (const [column, value] of columns.entries()) for (const rectangle of value.nodes) {
    if (located.has(rectangle.id)) throw new Error('Task dependency routing received duplicate node identities.');
    located.set(rectangle.id, { rectangle, column });
  }
  return edges.map((edge) => {
    const source = located.get(edge.source);
    const target = located.get(edge.target);
    if (source === undefined || target === undefined || source.column >= target.column) throw new Error('Task dependency routing requires forward endpoints in distinct columns.');
    if (edge.points.length < 2 || edge.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('Task dependency routing received invalid layout waypoints.');
    const first = { x: source.rectangle.right, y: midpoint(source.rectangle.top, source.rectangle.bottom) };
    const last = { x: target.rectangle.left, y: midpoint(target.rectangle.top, target.rectangle.bottom) };
    const exit = { x: midpoint(source.rectangle.right, columns[source.column + 1]!.left), y: first.y };
    const entry = { x: midpoint(columns[target.column - 1]!.right, target.rectangle.left), y: last.y };
    const anchors: CanvasPoint[] = [exit];
    for (const point of edge.points.slice(1, -1)) {
      if (point.x <= exit.x || point.x >= entry.x) continue;
      const index = firstMatching(columns, (column) => column.right >= point.x);
      const column = columns[index];
      if (column !== undefined && point.x >= column.left) append(anchors, { x: point.x, y: freeRow(column, point.y) });
    }
    append(anchors, entry);
    const planned: CanvasPoint[] = [first, exit];
    for (let index = 1; index < anchors.length; index++) {
      const from = anchors[index - 1]!;
      const to = anchors[index]!;
      if (clearSpan(columns, from, to)) append(planned, to);
      else for (const point of routeBlockedSpan(columns, from, to)) append(planned, point);
    }
    append(planned, last);
    return { ...edge, points: planned };
  });
};
