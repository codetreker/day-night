import { describe, expect, it } from 'vitest';
import { inspectDependencySnapshot, parseCurve, referenceLength, type DependencySnapshot, type GeometryExpectation } from './e2e/dependency-geometry';

const d = 'M100,50 L188,50 Q200,50 200,62 L200,88 Q200,100 212,100 L238,100 Q250,100 250,88 L250,62 Q250,50 262,50 L300,50';
const color = 'rgb(171, 178, 199)';
const expected: GeometryExpectation = { nodes: [{ id: 'source' }, { id: 'target' }], edges: [{ id: 'source->target', source: 'source', target: 'target', external: true, points: [{ x: 100, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 100 }, { x: 250, y: 100 }, { x: 250, y: 50 }, { x: 300, y: 50 }] }] };
const snapshot = (): DependencySnapshot => ({
  nodes: [{ id: 'source', left: 0, top: 0, right: 100, bottom: 100 }, { id: 'target', left: 300, top: 0, right: 400, bottom: 100 }],
  edges: [{ id: 'source->target', source: 'source', target: 'target', d, dashed: true, stroke: 'none', color, marker: '#arrow', pieces: [
    { d, matrix: [1, 0, 0, 1, 0, 0], line: false, phase: 0, dash: '5px, 4px', stroke: color, width: 1.5, cap: 'butt', join: 'miter', hidden: true },
  ] }],
  markers: [{ id: 'arrow', orient: 'auto-start-reverse', units: 'strokeWidth', viewBox: '-10 -10 20 20', width: '16', height: '16', refX: '0', refY: '0', points: '-5,-4 0,0 -5,4 -5,-4', stroke: color, fill: color }],
  declaredPieces: 1, viewport: true, passive: true,
});

describe('independent production dependency geometry oracle', () => {
  it('accepts smooth complete quadratics and native dashed paint independently of production routes', () => {
    expect(inspectDependencySnapshot(snapshot(), expected)).toEqual([]);
  });
  it('rejects missing edges, wrong arrows, curves through nodes, and true-arclength phase deviations', () => {
    const missing = snapshot(); missing.edges = []; missing.declaredPieces = 0;
    expect(inspectDependencySnapshot(missing, expected)).toContain('edges: incomplete edge coverage');
    const arrow = snapshot(); arrow.markers[0]!.points = '5,-4 0,0 5,4';
    expect(inspectDependencySnapshot(arrow, expected).some((failure) => failure.includes('wrong arrow'))).toBe(true);
    const crossing = snapshot(); crossing.nodes.push({ id: 'obstacle', left: 196, top: 54, right: 201, bottom: 62 });
    expect(inspectDependencySnapshot(crossing, { ...expected, nodes: [...expected.nodes, { id: 'obstacle' }] }).some((failure) => failure.includes('curve passes through node obstacle'))).toBe(true);
    const phase = snapshot(); phase.edges[0]!.pieces[0]!.phase = 0.2;
    expect(inspectDependencySnapshot(phase, expected).some((failure) => failure.includes('dash phase'))).toBe(true);
  });
  it('rejects a valid endpoint path whose native paint skips or changes its curve', () => {
    const skipped = snapshot(); skipped.edges[0]!.pieces[0]!.d = 'M100,50 L300,50';
    expect(inspectDependencySnapshot(skipped, expected).some((failure) => failure.includes('canonical route'))).toBe(true);
    const changed = snapshot(); changed.edges[0]!.pieces[0]!.d = d.replace('Q200,50', 'Q199,50');
    expect(inspectDependencySnapshot(changed, expected).some((failure) => failure.includes('paint curve differs'))).toBe(true);
  });
  it('rejects smooth shortcuts that drop a Dagre routing corner', () => {
    const value = snapshot(); value.edges[0]!.d = 'M100,50 L300,50'; value.edges[0]!.pieces[0]!.d = 'M100,50 L300,50';
    expect(inspectDependencySnapshot(value, expected).some((failure) => failure.includes('missing layout corner'))).toBe(true);
  });
  it('checks paint seams and phase after a quadratic using true curve arclength', () => {
    const value = snapshot();
    const prefix = 88 + referenceLength(parseCurve('M188,50 Q200,50 200,62')[0]!);
    const seam = Math.ceil((prefix - 7) / 9) * 9 + 7;
    const y = 62 + seam - prefix;
    const original = value.edges[0]!.pieces[0]!;
    value.edges[0]!.pieces = [
      { ...original, d: `M100,50 L188,50 Q200,50 200,62 L200,${y}` },
      { ...original, d: `M200,${y} L200,88 Q200,100 212,100 L238,100 Q250,100 250,88 L250,62 Q250,50 262,50 L300,50`, phase: 7 },
    ];
    value.declaredPieces = 2;
    expect(inspectDependencySnapshot(value, expected)).toEqual([]);
    value.edges[0]!.pieces[1]!.phase = 7.2;
    expect(inspectDependencySnapshot(value, expected).some((failure) => failure.includes('dash phase'))).toBe(true);
  });
  it('resolves the hosted diagonal SVG endpoint using graph distance after native numeric rounding', () => {
    const value = snapshot();
    value.nodes = [{ id: 'source', left: 316, top: 32, right: 536, bottom: 128 }, { id: 'target', left: 600, top: 224, right: 820, bottom: 320 }];
    const edge = value.edges[0]!;
    edge.d = 'M536,80 L556,80 Q568,80 575.1355182290425,89.64802464771945 L674.5,224';
    const original = edge.pieces[0]!;
    edge.pieces = [
      { ...original, d: 'M536,80 L556,80 Q568,80 575.1355182290425,89.64802464771945 L586.2503311048174,104.67650402904886' },
      { ...original, d: 'M0,0 L148.41192626953125,0', line: true, phase: 7,
        matrix: [0.5946265459060669, 0.8040021061897278, -0.8040021061897278, 0.5946265459060669, 586.2503051757812, 104.67650604248047] },
    ];
    value.declaredPieces = 2;
    const routed: GeometryExpectation = { nodes: expected.nodes, edges: [{ ...expected.edges[0]!, points: [{ x: 536, y: 80 }, { x: 568, y: 80 }, { x: 674.5, y: 224 }] }] };
    expect(inspectDependencySnapshot(value, routed)).toEqual([]);
    const gap = structuredClone(value); gap.edges[0]!.pieces[1]!.d = 'M0,0 L148.31192626953125,0';
    expect(inspectDependencySnapshot(gap, routed).some((failure) => failure.includes('incomplete canonical paint coverage'))).toBe(true);
    const offRoute = structuredClone(value); offRoute.edges[0]!.pieces[1]!.matrix[4]! += 0.05;
    expect(inspectDependencySnapshot(offRoute, routed).some((failure) => failure.includes('canonical coverage'))).toBe(true);
    const phase = structuredClone(value); phase.edges[0]!.pieces[1]!.phase = 7.2;
    expect(inspectDependencySnapshot(phase, routed).some((failure) => failure.includes('dash phase'))).toBe(true);
  });
  it('rejects real endpoint gaps on long lines without a length-dependent parameter allowance', () => {
    const value = snapshot();
    value.nodes[1] = { id: 'target', left: 68000100, top: 0, right: 68000200, bottom: 100 };
    value.edges[0]!.d = 'M100,50 L68000100,50';
    value.edges[0]!.pieces[0] = { ...value.edges[0]!.pieces[0]!, d: 'M0,0 L68000000,0', line: true, matrix: [1, 0, 0, 1, 100, 50] };
    const routed: GeometryExpectation = { nodes: expected.nodes, edges: [{ ...expected.edges[0]!, points: [{ x: 100, y: 50 }, { x: 68000100, y: 50 }] }] };
    expect(inspectDependencySnapshot(value, routed)).toEqual([]);
    value.edges[0]!.pieces[0]!.d = 'M0,0 L67999999.9,0';
    expect(inspectDependencySnapshot(value, routed).some((failure) => failure.includes('incomplete canonical paint coverage'))).toBe(true);
  });
  it('bounds a quadratic arc independently and handles enormous straight distances without sampling them', () => {
    const segment = parseCurve('M0,0 Q0,1 1,1')[0]!;
    const exact = 1 + Math.asinh(1) / Math.SQRT2;
    expect(Math.abs(referenceLength(segment) - exact)).toBeLessThan(0.0001);
    expect(referenceLength(parseCurve('M0,0 L68000000,0')[0]!)).toBe(68000000);
    for (const invalid of ['', 'M0,0 LNaN,2', 'M0,0 C1,2 3,4 5,6', 'M0,0 L0,0', 'm0,0 l1,1']) expect(() => parseCurve(invalid)).toThrow();
  });
});
