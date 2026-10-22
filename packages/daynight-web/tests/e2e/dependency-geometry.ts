import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import type { CanvasLayout } from '../../src/features/task-graph/layout';

export const checkDependencyGeometry = async (page: Page, expected: CanvasLayout): Promise<void> => {
  await expect(page.locator('.task-dependency-edges')).toHaveCount(1);
  await expect(page.locator('.task-dependency-edge')).toHaveCount(expected.edges.length);
  const diagnostics = await page.evaluate((geometry: CanvasLayout) => {
    const failures: string[] = [];
    const svg = document.querySelector<SVGSVGElement>('.task-dependency-edges');
    const viewport = document.querySelector('.react-flow__viewport');
    if (svg === null || viewport === null) return ['The dependency layer or viewport is absent.'];
    if (svg.closest('.react-flow__viewport') !== viewport) failures.push('Dependency SVG uses a different viewport.');
    if (getComputedStyle(svg).pointerEvents !== 'none') failures.push('Dependency SVG captures pointer input.');
    if (svg.hasAttribute('viewBox')) failures.push('Dependency SVG rescales the layout coordinates.');
    const declaredPieces = svg.getAttribute('data-paint-piece-count');
    const bodyPieces = svg.querySelectorAll('.task-dependency-paint-piece');
    if (declaredPieces === null || !/^(0|[1-9]\d*)$/.test(declaredPieces) || !Number.isSafeInteger(Number(declaredPieces)) || Number(declaredPieces) !== bodyPieces.length) failures.push('Dependency paint pieces differ from the complete declared count.');
    if (svg.querySelectorAll('[tabindex]:not([tabindex="-1"])').length !== 0) failures.push('Dependency SVG has a keyboard focus target.');
    const expectedIds = new Set(geometry.edges.map((edge) => edge.id));
    const actualIds = [...svg.querySelectorAll('.task-dependency-edge')].map((edge) => edge.getAttribute('data-id'));
    if (actualIds.length !== expectedIds.size || new Set(actualIds).size !== expectedIds.size || actualIds.some((id) => id === null || !expectedIds.has(id))) failures.push('Dependency identities differ from the active projection.');
    const expectedNodeIds = new Set(geometry.nodes.map((node) => node.id));
    const actualNodeIds = [...viewport.querySelectorAll('.react-flow__node')].map((node) => node.getAttribute('data-id'));
    if (actualNodeIds.length !== expectedNodeIds.size || new Set(actualNodeIds).size !== expectedNodeIds.size || actualNodeIds.some((id) => id === null || !expectedNodeIds.has(id))) failures.push('Task identities differ from the active projection.');
    for (const expectedNode of geometry.nodes) {
      const element = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${expectedNode.id}"]`);
      if (element === null || element.closest('.react-flow__viewport') !== viewport) failures.push(`Node ${expectedNode.id} uses a different viewport.`);
    }
    const onBorder = (point: DOMPoint, bounds: DOMRect): boolean => {
      const epsilon = 0.75;
      return point.x >= bounds.left - epsilon && point.x <= bounds.right + epsilon
        && point.y >= bounds.top - epsilon && point.y <= bounds.bottom + epsilon
        && Math.min(Math.abs(point.x - bounds.left), Math.abs(point.x - bounds.right), Math.abs(point.y - bounds.top), Math.abs(point.y - bounds.bottom)) <= epsilon;
    };
    for (const edge of geometry.edges) {
      const group = svg.querySelector<SVGGElement>(`.task-dependency-edge[data-id="${edge.id}"]`);
      const path = group?.querySelector<SVGPathElement>('path.react-flow__edge-path');
      const source = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${edge.source}"]`);
      const target = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${edge.target}"]`);
      if (group === null || path === undefined || path === null || source === null || target === null) {
        failures.push(`Dependency ${edge.id} lacks its path or endpoint nodes.`);
        continue;
      }
      if (group.getAttribute('role') !== 'img' || group.getAttribute('focusable') !== 'false' || !(group.getAttribute('aria-label') ?? '').includes(edge.source) || !(group.getAttribute('aria-label') ?? '').includes(edge.target)) failures.push(`Dependency ${edge.id} lost its accessible identity.`);
      const expectedPath = edge.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
      if (path.getAttribute('d') !== expectedPath || path.dataset.source !== edge.source || path.dataset.target !== edge.target) failures.push(`Dependency ${edge.id} lost layout points or endpoint identities.`);
      if (path.getAttribute('aria-hidden') !== 'true' || getComputedStyle(path).pointerEvents !== 'none') failures.push(`Dependency ${edge.id} is interactive.`);
      const dashed = getComputedStyle(path).strokeDasharray !== 'none';
      if (dashed !== edge.external) failures.push(`Dependency ${edge.id} has an incorrect external style.`);
      const pieces = [...group.querySelectorAll<SVGGraphicsElement>('.task-dependency-paint-piece')];
      if (edge.external !== (pieces.length > 0) || (edge.external ? getComputedStyle(path).stroke !== 'none' : getComputedStyle(path).stroke === 'none')) failures.push(`Dependency ${edge.id} has incomplete or duplicate body paint.`);
      if (edge.external) {
        const epsilon = 0.001;
        const svgMatrix = svg.getScreenCTM();
        if (svgMatrix === null) {
          failures.push(`Dependency ${edge.id} has no painted viewport matrix.`);
          continue;
        }
        let accumulated = 0;
        const segments: { from: CanvasLayout['edges'][number]['points'][number]; to: CanvasLayout['edges'][number]['points'][number]; start: number; length: number }[] = [];
        for (let index = 1; index < edge.points.length; index++) {
          const from = edge.points[index - 1]!;
          const to = edge.points[index]!;
          const length = Math.hypot(to.x - from.x, to.y - from.y);
          if (length > 0) segments.push({ from, to, start: accumulated, length });
          accumulated += length;
        }
        const alongRoute = (point: DOMPoint, minimum: number): number | null => {
          for (const segment of segments) {
            const dx = segment.to.x - segment.from.x;
            const dy = segment.to.y - segment.from.y;
            const fraction = ((point.x - segment.from.x) * dx + (point.y - segment.from.y) * dy) / (segment.length * segment.length);
            const projected = { x: segment.from.x + dx * fraction, y: segment.from.y + dy * fraction };
            const distance = segment.start + Math.max(0, Math.min(1, fraction)) * segment.length;
            if (fraction >= -epsilon / segment.length && fraction <= 1 + epsilon / segment.length && Math.hypot(point.x - projected.x, point.y - projected.y) <= epsilon && distance >= minimum - epsilon) return distance;
          }
          return null;
        };
        let covered = 0;
        for (const piece of pieces) {
          const style = getComputedStyle(piece);
          const dash = style.strokeDasharray.match(/[-+\d.]+/g)?.map(Number);
          if (piece.getAttribute('aria-hidden') !== 'true' || piece.getAttribute('focusable') !== 'false' || style.pointerEvents !== 'none' || style.stroke !== 'rgb(171, 178, 199)' || Number.parseFloat(style.strokeWidth) !== 1.5 || style.strokeLinecap !== 'butt' || style.strokeLinejoin !== 'miter' || piece instanceof SVGPathElement && style.fill !== 'none' || dash?.length !== 2 || dash[0] !== 5 || dash[1] !== 4) failures.push(`Dependency ${edge.id} changed native dash paint semantics.`);
          const pieceMatrix = piece.getScreenCTM();
          if (pieceMatrix === null) {
            failures.push(`Dependency ${edge.id} has a body piece without geometry.`);
            continue;
          }
          const localToGraph = svgMatrix.inverse().multiply(pieceMatrix);
          let localPoints: { x: number; y: number }[];
          if (piece instanceof SVGLineElement && piece.dataset.pieceKind === 'line') {
            localPoints = [{ x: piece.x1.baseVal.value, y: piece.y1.baseVal.value }, { x: piece.x2.baseVal.value, y: piece.y2.baseVal.value }];
            if (localPoints[0]!.x !== 0 || localPoints[0]!.y !== 0 || localPoints[1]!.y !== 0 || localPoints[1]!.x <= 0 || Math.abs(Math.hypot(localToGraph.a, localToGraph.b) - 1) > epsilon || Math.abs(localToGraph.a - localToGraph.d) > epsilon || Math.abs(localToGraph.b + localToGraph.c) > epsilon) failures.push(`Dependency ${edge.id} has a non-axis or rescaled line body.`);
          } else if (piece instanceof SVGPathElement && piece.dataset.pieceKind === 'path') {
            const commands = [...(piece.getAttribute('d') ?? '').matchAll(/[ML]([^ML]+)/g)];
            localPoints = commands.map((command) => {
              const coordinates = command[1]!.trim().split(/[ ,]+/).map(Number);
              return { x: coordinates[0]!, y: coordinates[1]! };
            });
          } else {
            failures.push(`Dependency ${edge.id} has an unknown paint primitive.`);
            continue;
          }
          if (localPoints.length < 2 || localPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
            failures.push(`Dependency ${edge.id} has an invalid native join path.`);
            continue;
          }
          const points = localPoints.map((point) => new DOMPoint(point.x, point.y).matrixTransform(localToGraph));
          const distances: number[] = [];
          let previous = covered;
          for (const point of points) {
            const distance = alongRoute(point, previous);
            if (distance === null) break;
            distances.push(distance);
            previous = distance;
          }
          if (distances.length !== points.length || Math.abs(distances[0]! - covered) > epsilon) {
            failures.push(`Dependency ${edge.id} omits, overlaps or leaves its canonical route.`);
            continue;
          }
          let paintedLength = 0;
          for (let index = 1; index < points.length; index++) paintedLength += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
          const start = distances[0]!;
          const end = distances[distances.length - 1]!;
          const phase = ((start % 9) + 9) % 9;
          if (Math.abs(paintedLength - (end - start)) > epsilon || Math.abs(Number.parseFloat(style.strokeDashoffset) - phase) > epsilon) failures.push(`Dependency ${edge.id} changes route length or continuous dash phase.`);
          if (start > epsilon && Math.abs(phase - 7) > epsilon) failures.push(`Dependency ${edge.id} separates native joins outside a dash gap.`);
          covered = end;
        }
        if (Math.abs(covered - accumulated) > epsilon) failures.push(`Dependency ${edge.id} does not paint its complete canonical body.`);
      }
      const matrix = path.getScreenCTM();
      const first = edge.points[0]!;
      const last = edge.points[edge.points.length - 1]!;
      if (matrix === null || !onBorder(new DOMPoint(first.x, first.y).matrixTransform(matrix), source.getBoundingClientRect()) || !onBorder(new DOMPoint(last.x, last.y).matrixTransform(matrix), target.getBoundingClientRect())) failures.push(`Dependency ${edge.id} does not meet its rendered endpoint boundaries.`);
      const markerId = /#([^#)]+)\)/.exec(path.getAttribute('marker-end') ?? '')?.[1];
      if (markerId === undefined || !svg.querySelectorAll('marker').values().some((marker) => marker.id === markerId)) failures.push(`Dependency ${edge.id} has no local arrow marker.`);
    }
    return failures;
  }, expected);
  expect(diagnostics, 'Every static dependency follows all Dagre points and the actual transformed task boundaries').toEqual([]);
};
