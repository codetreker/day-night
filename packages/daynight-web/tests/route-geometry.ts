export type Point = { x: number; y: number };
export type Curve = { kind: 'L' | 'Q'; from: Point; to: Point; control?: Point };
export type Rectangle = { left: number; right: number; top: number; bottom: number };
export const distance = (from: Point, to: Point) => Math.hypot(to.x - from.x, to.y - from.y);
export const parseRoute = (d: string): Curve[] => {
  const tokens = d.match(/[MLQ]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!;
  if (tokens.join('').toLowerCase() !== d.replace(/[\s,]/g, '').toLowerCase()) throw new Error('Unexpected route syntax.');
  let cursor = 0;
  const point = (): Point => ({ x: Number(tokens[cursor++]), y: Number(tokens[cursor++]) });
  if (tokens[cursor++] !== 'M') throw new Error('Route must start with M.');
  let from = point();
  const result: Curve[] = [];
  while (cursor < tokens.length) {
    const kind = tokens[cursor++];
    if (kind !== 'L' && kind !== 'Q') throw new Error('Unexpected route command.');
    const control = kind === 'Q' ? point() : undefined;
    const to = point();
    result.push(control === undefined ? { kind, from, to } : { kind, from, control, to });
    from = to;
  }
  return result;
};
export const at = (curve: Curve, t: number): Point => curve.kind === 'L'
  ? { x: curve.from.x + (curve.to.x - curve.from.x) * t, y: curve.from.y + (curve.to.y - curve.from.y) * t }
  : { x: (1 - t) ** 2 * curve.from.x + 2 * (1 - t) * t * curve.control!.x + t * t * curve.to.x, y: (1 - t) ** 2 * curve.from.y + 2 * (1 - t) * t * curve.control!.y + t * t * curve.to.y };

// This derivative-based Simpson reference is independent of the compiler's
// chord/control-polygon enclosure and the planner's free-row construction.
export const arcLength = (curve: Curve): number => {
  if (curve.kind === 'L') return distance(curve.from, curve.to);
  const speed = (t: number) => 2 * Math.hypot((1 - t) * (curve.control!.x - curve.from.x) + t * (curve.to.x - curve.control!.x), (1 - t) * (curve.control!.y - curve.from.y) + t * (curve.to.y - curve.control!.y));
  const steps = 1024;
  let sum = speed(0) + speed(1);
  for (let index = 1; index < steps; index++) sum += (index % 2 === 0 ? 2 : 4) * speed(index / steps);
  return sum / (3 * steps);
};
const roots = (a: number, b: number, c: number): number[] => {
  if (a === 0) return b === 0 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  return discriminant < 0 ? [] : [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)];
};

// Rectangle-boundary roots partition the parameter interval into regions with
// constant membership. Midpoint membership therefore proves each entire region.
export const entersRectangle = (curve: Curve, rectangle: Rectangle): boolean => {
  const breaks = [0, 1];
  for (const [axis, limits] of [['x', [rectangle.left, rectangle.right]], ['y', [rectangle.top, rectangle.bottom]]] as const) for (const value of limits) {
    const candidates = curve.kind === 'L' ? [(value - curve.from[axis]) / (curve.to[axis] - curve.from[axis])]
      : roots(curve.from[axis] - 2 * curve.control![axis] + curve.to[axis], 2 * (curve.control![axis] - curve.from[axis]), curve.from[axis] - value);
    breaks.push(...candidates.filter((t) => t > 0 && t < 1));
  }
  breaks.sort((first, second) => first - second);
  return breaks.slice(1).some((end, index) => {
    const p = at(curve, (end + breaks[index]!) / 2);
    return p.x > rectangle.left + 1e-7 && p.x < rectangle.right - 1e-7 && p.y > rectangle.top + 1e-7 && p.y < rectangle.bottom - 1e-7;
  });
};
