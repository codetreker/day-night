import { describe, expect, it } from 'vitest';
import { captureStableDependencyGeometry, expectedDependencyTopology, inspectDependencySnapshot, parseCurve, referenceLength, summarizeGeometryFailures, type DependencySnapshot, type GeometryExpectation } from './e2e/dependency-geometry';

const d = 'M100,50 L188,50 Q200,50 200,62 L200,88 Q200,100 212,100 L238,100 Q250,100 250,88 L250,62 Q250,50 262,50 L300,50';
const color = 'rgb(171, 178, 199)';
const expected: GeometryExpectation = { nodes: [{ id: 'source' }, { id: 'target' }], edges: [{ id: 'source->target', source: 'source', target: 'target', external: true }] };
const compilerInputs = [{ id: 'source->target', points: [{ x: 100, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 100 }, { x: 250, y: 100 }, { x: 250, y: 50 }, { x: 300, y: 50 }] }];
const snapshot = (): DependencySnapshot => ({
  nodes: [{ id: 'source', left: 0, top: 0, right: 100, bottom: 100 }, { id: 'target', left: 300, top: 0, right: 400, bottom: 100 }],
  edges: [{ id: 'source->target', source: 'source', target: 'target', d, external: 'true', stroke: 'none', fill: 'none', color, bodyMatrix: [1, 0, 0, 1, 0, 0], bodyVisible: true, marker: '#arrow', canonicalVisible: true, pieces: [
    { d, matrix: [1, 0, 0, 1, 0, 0], line: false, phase: 0, dash: '5px, 4px', stroke: color, width: 1.5, cap: 'butt', join: 'miter', hidden: true },
  ] }],
  markers: [{ id: 'arrow', orient: 'auto-start-reverse', units: 'strokeWidth', viewBox: '-10 -10 20 20', width: '16', height: '16', refX: '0', refY: '0', points: '-5,-4 0,0 -5,4 -5,-4', stroke: color, fill: color, strokeWidth: 1, cap: 'round', join: 'round' }],
  declaredPieces: 1, viewport: true, passive: true,
});

describe('independent production dependency geometry oracle', () => {
  it('accepts smooth complete quadratics and native dashed paint independently of production routes', () => {
    expect(inspectDependencySnapshot(snapshot(), expected)).toEqual([]);
  });
  it('derives projection identities only from API dependencies, including complete upstream context', () => {
    expect(expectedDependencyTopology([
      { id: 'A', dependsOn: [] }, { id: 'C', dependsOn: ['A', 'X'] }, { id: 'P', dependsOn: [] },
      { id: 'X', dependsOn: ['P'] }, { id: 'Y', dependsOn: ['X'] }, { id: 'Z', dependsOn: [] },
    ], 'A')).toEqual({
      nodes: [{ id: 'A' }, { id: 'C' }, { id: 'P' }, { id: 'X' }],
      edges: [{ id: 'A->C', source: 'A', target: 'C', external: false }, { id: 'X->C', source: 'X', target: 'C', external: true }, { id: 'P->X', source: 'P', target: 'X', external: true }],
    });
  });
  it('checks actual quadratic bounds without any declared compiler input', () => {
    const value = snapshot(); value.edges[0]!.d = d.replace('Q200,50', 'Q205,50');
    expect(inspectDependencySnapshot(value, expected).some((failure) => failure.includes('bounded symmetric corner'))).toBe(true);
  });
  it('separates declared compiler-input fidelity from independent topology and route validity', () => {
    const value = snapshot();
    expect(inspectDependencySnapshot(value, expected)).toEqual([]);
    expect(inspectDependencySnapshot(value, expected, compilerInputs)).toEqual([]);
    const changedInput = [{ id: 'source->target', points: compilerInputs[0]!.points.map((p) => p.x === 200 && p.y === 50 ? { x: 201, y: 50 } : p) }];
    expect(inspectDependencySnapshot(value, expected, changedInput).some((failure) => failure.includes('declared compiler input'))).toBe(true);
    const wrongTopology: GeometryExpectation = { nodes: expected.nodes, edges: [{ ...expected.edges[0]!, source: 'target', target: 'source' }] };
    expect(inspectDependencySnapshot(value, wrongTopology, compilerInputs).some((failure) => failure.includes('wrong dependency topology'))).toBe(true);
  });
  it('rejects missing edges, wrong arrows, curves through nodes, and true-arclength phase deviations', () => {
    const missing = snapshot(); missing.edges = []; missing.declaredPieces = 0;
    expect(inspectDependencySnapshot(missing, expected)).toContain('edges: incomplete edge coverage');
    const arrow = snapshot(); arrow.markers[0]!.points = '5,-4 0,0 5,4';
    expect(inspectDependencySnapshot(arrow, expected).some((failure) => failure.includes('wrong native arrow marker'))).toBe(true);
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
  it('rejects smooth shortcuts that drop a planned routing corner', () => {
    const value = snapshot(); value.edges[0]!.d = 'M100,50 L300,50'; value.edges[0]!.pieces[0]!.d = 'M100,50 L300,50';
    expect(inspectDependencySnapshot(value, expected, compilerInputs).some((failure) => failure.includes('declared input corner'))).toBe(true);
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
  it('rejects obsolete top-port geometry without mistaking native rounding for missing paint', () => {
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
    const inputs = [{ id: expected.edges[0]!.id, points: [{ x: 536, y: 80 }, { x: 568, y: 80 }, { x: 674.5, y: 224 }] }];
    const failures = inspectDependencySnapshot(value, expected, inputs);
    expect(failures).toEqual(['source->target: wrong fixed left-to-right ports', 'source->target: endpoint direction is not horizontal left-to-right']);
    const gap = structuredClone(value); gap.edges[0]!.pieces[1]!.d = 'M0,0 L148.31192626953125,0';
    expect(inspectDependencySnapshot(gap, expected, inputs).some((failure) => failure.includes('incomplete canonical paint coverage'))).toBe(true);
    const offRoute = structuredClone(value); offRoute.edges[0]!.pieces[1]!.matrix[4]! += 0.05;
    expect(inspectDependencySnapshot(offRoute, expected, inputs).some((failure) => failure.includes('canonical coverage'))).toBe(true);
    const phase = structuredClone(value); phase.edges[0]!.pieces[1]!.phase = 7.2;
    expect(inspectDependencySnapshot(phase, expected, inputs).some((failure) => failure.includes('dash phase'))).toBe(true);
  });
  it('resolves native SVG rounding at fixed horizontal ports in graph units', () => {
    const value = snapshot();
    const start = 675.12345; const end = start + 148.41192927402753;
    value.nodes = [{ id: 'source', left: start - 220, top: 32, right: start, bottom: 128 }, { id: 'target', left: end, top: 32, right: end + 220, bottom: 128 }];
    value.edges[0]!.d = `M${start},80 L${end},80`;
    value.edges[0]!.pieces[0] = { ...value.edges[0]!.pieces[0]!, d: 'M0,0 L148.41192626953125,0', line: true, matrix: [1, 0, 0, 1, 675.1234741210938, 80] };
    const inputs = [{ id: expected.edges[0]!.id, points: [{ x: start, y: 80 }, { x: end, y: 80 }] }];
    expect(inspectDependencySnapshot(value, expected, inputs)).toEqual([]);
  });
  it('rejects shifted ports and diagonal arrival even when endpoints remain on a card border', () => {
    const shifted = snapshot(); shifted.edges[0]!.d = d.replace('M100,50', 'M100,49');
    expect(inspectDependencySnapshot(shifted, expected).some((failure) => failure.includes('wrong fixed left-to-right ports'))).toBe(true);
    const diagonal = snapshot(); diagonal.edges[0]!.d = d.replace('L300,50', 'Q280,60 300,50');
    expect(inspectDependencySnapshot(diagonal, expected).some((failure) => failure.includes('endpoint direction is not horizontal'))).toBe(true);
  });
  it('reports the full failure count with bounded examples without discarding any input failures', () => {
    const failures = Array.from({ length: 25 }, (_, index) => `edge-${index}: collision`);
    expect(summarizeGeometryFailures(failures)).toEqual({ total: 25, examples: failures.slice(0, 12) });
    expect(failures).toHaveLength(25);
    expect(summarizeGeometryFailures([])).toEqual({ total: 0, examples: [] });
  });
  it('requires visible native arrow owners, graph-coordinate body paint and matching marker color', () => {
    for (const mutate of [
      (value: DependencySnapshot) => { value.edges[0]!.marker = null; },
      (value: DependencySnapshot) => { value.edges[0]!.canonicalVisible = false; },
      (value: DependencySnapshot) => { value.edges[0]!.bodyVisible = false; },
      (value: DependencySnapshot) => { value.edges[0]!.bodyMatrix[4] = 1; },
      (value: DependencySnapshot) => { value.markers[0]!.fill = 'rgb(103, 98, 206)'; },
      (value: DependencySnapshot) => { value.markers[0]!.units = 'userSpaceOnUse'; },
    ]) { const value = snapshot(); mutate(value); expect(inspectDependencySnapshot(value, expected).length).toBeGreaterThan(0); }
  });
  it('rejects real endpoint gaps on long lines without a length-dependent parameter allowance', () => {
    const value = snapshot();
    value.nodes[1] = { id: 'target', left: 68000100, top: 0, right: 68000200, bottom: 100 };
    value.edges[0]!.d = 'M100,50 L68000100,50';
    value.edges[0]!.pieces[0] = { ...value.edges[0]!.pieces[0]!, d: 'M0,0 L68000000,0', line: true, matrix: [1, 0, 0, 1, 100, 50] };
    const inputs = [{ id: expected.edges[0]!.id, points: [{ x: 100, y: 50 }, { x: 68000100, y: 50 }] }];
    expect(inspectDependencySnapshot(value, expected, inputs)).toEqual([]);
    value.edges[0]!.pieces[0]!.d = 'M0,0 L67999999.9,0';
    expect(inspectDependencySnapshot(value, expected, inputs).some((failure) => failure.includes('incomplete canonical paint coverage'))).toBe(true);
  });
  it('bounds a quadratic arc independently and handles enormous straight distances without sampling them', () => {
    const segment = parseCurve('M0,0 Q0,1 1,1')[0]!;
    const exact = 1 + Math.asinh(1) / Math.SQRT2;
    expect(Math.abs(referenceLength(segment) - exact)).toBeLessThan(0.0001);
    expect(referenceLength(parseCurve('M0,0 L68000000,0')[0]!)).toBe(68000000);
    for (const invalid of ['', 'M0,0 LNaN,2', 'M0,0 C1,2 3,4 5,6', 'M0,0 L0,0', 'm0,0 l1,1']) expect(() => parseCurve(invalid)).toThrow();
  });
});

describe('chart-relative dependency stability observation', () => {
  const fixture = () => {
    document.body.innerHTML = '<div class="task-graph-canvas"><div class="react-flow__viewport" style="transform:translate(6.4px,-3083.1px) scale(0.8)"><svg class="task-dependency-edges"><g class="task-dependency-edge"><g class="task-dependency-body"></g></g></svg></div></div>';
    const screen = (x: number, y: number): DOMMatrix => ({
      a: 0.8, b: 0, c: 0, d: 0.8, e: x, f: y,
      inverse: () => ({
        a: 1.25, b: 0, c: 0, d: 1.25, e: -x / 0.8, f: -y / 0.8,
        multiply: (owner: DOMMatrix) => ({ a: owner.a / 0.8, b: owner.b / 0.8, c: owner.c / 0.8, d: owner.d / 0.8, e: (owner.e - x) / 0.8, f: (owner.f - y) / 0.8 }),
      }),
    }) as DOMMatrix;
    let root: DOMMatrix | null = screen(237.4, -1907.5078125);
    let owner: DOMMatrix | null = screen(237.4, -1907.5078125);
    Object.defineProperty(document.querySelector('svg'), 'getScreenCTM', { value: () => root });
    for (const element of document.querySelectorAll('g')) Object.defineProperty(element, 'getScreenCTM', { value: () => owner });
    return { screen, setRoot: (value: DOMMatrix | null) => { root = value; }, setOwner: (value: DOMMatrix | null) => { owner = value; } };
  };
  it('retains identical chart geometry across the hosted 621px page translation and records raw screen movement', () => {
    const value = fixture(); const initial = captureStableDependencyGeometry();
    value.setRoot(value.screen(237.4, -2528.5078125)); value.setOwner(value.screen(237.4, -2528.5078125));
    const scrolled = captureStableDependencyGeometry();
    expect(scrolled.geometry).toEqual(initial.geometry);
    expect(scrolled.geometry.owners).toEqual([[1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0]]);
    expect(scrolled.diagnostics.rootScreen[5]! - initial.diagnostics.rootScreen[5]!).toBe(-621);
    expect(scrolled.diagnostics.ownerScreens.map((matrix, index) => matrix[5]! - initial.diagnostics.ownerScreens[index]![5]!)).toEqual([-621, -621]);
    value.setOwner(value.screen(237.4, -2527.5078125));
    expect(captureStableDependencyGeometry().geometry).not.toEqual(scrolled.geometry);
  });
  it('rejects missing and nonfinite actual root or owner matrices', () => {
    for (const missing of [true, false]) for (const which of ['root', 'owner'] as const) {
      const value = fixture(); const matrix = missing ? null : value.screen(237.4, Number.NaN);
      if (which === 'root') value.setRoot(matrix); else value.setOwner(matrix);
      expect(() => captureStableDependencyGeometry()).toThrow(missing ? /no actual screen matrix/ : /nonfinite matrix/);
    }
  });
});
