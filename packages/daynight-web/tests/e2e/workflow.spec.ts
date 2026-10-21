import { randomUUID } from 'node:crypto';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect, createProject, createTask, updateTask, withDependencyFailure, withProjectsFailure } from './fixtures';
import { parseTaskGraph } from '../../src/api/parse';
import { buildGraphIndex, projectRoot } from '../../src/features/task-graph/model';
import { layoutGraph, type CanvasLayout } from '../../src/features/task-graph/layout';
import type { PullRequestProperty } from '../../src/api/types';

const scenario = (description: string) => ({ annotation: { type: 'scenario', description } });
const node = (page: Page, id: string): Locator => page.locator(`.react-flow__node[data-id="${id}"] button.task-node`);
const root = (page: Page, id: string): Locator => page.locator(`#task-root-${id}`);
const stat = (page: Page, label: string): Locator => page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: new RegExp(`^${label}$`) }) }).locator('.stat-number');
const screenshot = async (page: Page, info: TestInfo, slug: string): Promise<void> => {
  const path = info.outputPath(`${slug}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach('scenario-screenshot', { path, contentType: 'image/png' });
};
const checkPullRequests = async (dialog: Locator, pullRequests: readonly PullRequestProperty[], page = 0): Promise<Locator> => {
  const region = dialog.getByRole('region', { name: '关联 PR', exact: true });
  await expect(region.getByRole('heading')).toHaveText(`关联 PR · ${pullRequests.length}`);
  const visible = pullRequests.slice(page * 100, (page + 1) * 100);
  const items = region.locator('.drawer-pr');
  await expect(items).toHaveCount(visible.length);
  expect(await items.locator('.drawer-pr-title').allTextContents()).toEqual(visible.map(({ title }) => title === '' ? '（空字符串）' : title));
  expect(await items.locator('.drawer-pr-value').allTextContents()).toEqual(visible.map(({ url }) => url === '' ? '（空字符串）' : url));
  if (pullRequests.length > 100) {
    await expect(region.getByRole('status')).toHaveText(`第 ${page * 100 + 1}–${page * 100 + visible.length} 项，共 ${pullRequests.length} 项`);
    await expect(region.getByRole('combobox', { name: '关联 PR 页码' })).toHaveValue(String(page));
  }
  await expect(region.locator('img,script,iframe,object')).toHaveCount(0);
  return region;
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const within = async <T,>(promise: Promise<T>, label: string, timeoutMs = 15_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
};
const loadAllProjects = async (page: Page): Promise<void> => {
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: '正在加载项目' })).toHaveCount(0);
  const more = page.getByRole('button', { name: '加载更多', exact: true });
  for (let count = 0; count < 200; count++) {
    if (!await more.isVisible()) {
      await expect(page.getByText('已加载全部项目')).toBeVisible();
      return;
    }
    const response = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/projects' && url.searchParams.has('cursor');
    });
    await more.click();
    expect((await response).status()).toBe(200);
    await expect(page.getByRole('button', { name: '正在加载更多…', exact: true })).toHaveCount(0);
  }
  throw new Error('Project pagination did not terminate within the acceptance bound.');
};
const openProject = async (page: Page, id: string, name: string): Promise<void> => {
  const response = await page.goto(`/projects/${id}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-type']).toContain('text/html');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
};

test('project-list', scenario('project-list'), async ({ page, request }, info) => {
  const prefix = `Pagination ${randomUUID()}`;
  const projects = [];
  for (let index = 0; index < 51; index++) {
    projects.push(await createProject(request, { name: `${prefix} ${String(index).padStart(2, '0')}` }));
  }
  const listRequests: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/projects') listRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('status', { name: '正在加载项目' })).toHaveCount(0);
  await expect(page.locator('a.project-card')).toHaveCount(50);
  const firstPage = await page.locator('a.project-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('href')));
  let failedCursor: string | null = null;
  await withProjectsFailure(async () => {
    const continuation = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/projects' && url.searchParams.has('cursor');
    });
    await page.getByRole('button', { name: '加载更多', exact: true }).click();
    const response = await continuation;
    expect(response.status()).toBe(500);
    failedCursor = new URL(response.url()).searchParams.get('cursor');
    expect(failedCursor).not.toBeNull();
    await expect(page.getByRole('alert')).toContainText('更多项目加载失败，已加载的项目仍可查看。');
    await expect(page.getByRole('button', { name: '重试加载更多', exact: true })).toBeVisible();
    expect(await page.locator('a.project-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('href')))).toEqual(firstPage);
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
  });
  const retried = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/projects' && url.searchParams.has('cursor');
  });
  await page.getByRole('button', { name: '重试加载更多', exact: true }).click();
  const successfulContinuation = await retried;
  expect(successfulContinuation.status()).toBe(200);
  expect(new URL(successfulContinuation.url()).searchParams.get('cursor')).toBe(failedCursor);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await loadAllProjects(page);
  for (const project of projects) {
    const card = page.locator(`a.project-card[href="/projects/${project.id}"]`);
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
    await expect(card).toContainText(project.repoUrl);
  }
  const hrefs = await page.locator('a.project-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('href')));
  expect(new Set(hrefs).size).toBe(hrefs.length);
  expect(listRequests.some((value) => new URL(value).searchParams.has('cursor'))).toBe(true);
  expect(listRequests.every((value) => new URL(value).searchParams.get('limit') === '50')).toBe(true);
  await screenshot(page, info, 'project-list');
  await page.locator(`a.project-card[href="/projects/${projects[50]!.id}"]`).click();
  await expect(page.getByRole('heading', { name: projects[50]!.name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '还没有任务' })).toBeVisible();
});

test('project-graph', scenario('project-graph'), async ({ page, request }, info) => {
  const project = await createProject(request, { name: `Shared graph ${randomUUID()}` });
  const a = await createTask(request, project.id, { title: 'A 已完成根' });
  const b = await createTask(request, project.id, { title: 'B 进行中根' });
  const c = await createTask(request, project.id, { title: 'C 已完成根' });
  await updateTask(request, project.id, a.id, { version: a.version, status: 'done' });
  await updateTask(request, project.id, b.id, { version: b.version, status: 'in_progress' });
  await updateTask(request, project.id, c.id, { version: c.version, status: 'done' });
  const d = await createTask(request, project.id, { title: 'D 菱形分支', dependsOn: [a.id] });
  const e = await createTask(request, project.id, { title: 'E 菱形分支', dependsOn: [a.id] });
  await updateTask(request, project.id, d.id, { version: d.version, status: 'done' });
  await updateTask(request, project.id, e.id, { version: e.version, status: 'done' });
  const f = await createTask(request, project.id, { title: 'F 三根共享合流', dependsOn: [d.id, e.id, b.id, c.id] });
  const g = await createTask(request, project.id, { title: 'G 共享后续', dependsOn: [f.id] });
  const independent = await createTask(request, project.id, { title: '独立待处理任务' });
  await openProject(page, project.id, project.name);
  for (const [label, value] of [['任务总数', '8'], ['已完成', '4'], ['待处理', '3'], ['进行中', '1'], ['可开始', '1'], ['被阻塞', '2']] as const) {
    await expect(stat(page, label)).toHaveText(value);
  }
  await expect(page.getByText('完成比例 50%')).toBeVisible();
  expect(await page.locator('.root-toggle').evaluateAll((items) => items.map((item) => item.id))).toEqual(
    [independent, c, b, a].map(({ id }) => `task-root-${id}`),
  );
  await expect(root(page, independent.id)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await root(page, a.id).click();
  await expect(root(page, a.id)).toHaveAttribute('aria-expanded', 'true');
  await expect(root(page, a.id).locator('.root-status')).toHaveText('已完成');
  await expect(root(page, a.id).locator('.root-progress-label')).toHaveText('3/5 已完成');
  await expect(root(page, independent.id)).toContainText('独立任务');
  await expect(page.locator('.task-graph-canvas')).toHaveCount(1);
  await expect(page.locator('.react-flow__node')).toHaveCount(7);
  await expect(page.locator('.react-flow__edge')).toHaveCount(7);
  const graphResponse = await request.get(`/api/v1/projects/${project.id}/task-graph`);
  expect(graphResponse.status()).toBe(200);
  const graphIndex = buildGraphIndex(parseTaskGraph(await graphResponse.json(), project.id));
  const checkEdges = async (rootId: string): Promise<void> => {
    const expected = layoutGraph(projectRoot(graphIndex, rootId));
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
      if (actualIds.length !== expectedIds.size || actualIds.some((id) => id === null || !expectedIds.has(id))) failures.push('Dependency identities differ from the active projection.');
      const expectedNodeIds = new Set(geometry.nodes.map((node) => node.id));
      const actualNodeIds = [...viewport.querySelectorAll('.react-flow__node')].map((node) => node.getAttribute('data-id'));
      if (actualNodeIds.length !== expectedNodeIds.size || actualNodeIds.some((id) => id === null || !expectedNodeIds.has(id))) failures.push('Task identities differ from the active projection.');
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
  await test.step('keeps every static dependency aligned with task nodes through zoom and pan', async () => {
    await checkEdges(a.id);
    const viewport = page.locator('.react-flow__viewport');
    const beforeZoom = await viewport.getAttribute('style');
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(beforeZoom);
    await checkEdges(a.id);
    const pane = page.locator('.react-flow__pane');
    const bounds = await pane.boundingBox();
    expect(bounds).not.toBeNull();
    const beforePan = await viewport.getAttribute('style');
    await page.mouse.move(bounds!.x + 15, bounds!.y + bounds!.height - 15);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 75, bounds!.y + bounds!.height - 50, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(beforePan);
    await checkEdges(a.id);
  });
  await expect(page.locator('.task-node-boundary')).toHaveCount(2);
  await expect(page.locator('.task-boundary-label')).toHaveText(['外部前置，上游已省略', '外部前置，上游已省略']);
  await expect(node(page, f.id).locator('.task-shared-label')).toHaveText('共享');
  await expect(node(page, g.id).locator('.task-shared-label')).toHaveText('共享');
  await expect(node(page, f.id).locator('.graph-blocked-badge')).toHaveText('被阻塞');
  const colors = await Promise.all([a.id, b.id, f.id].map((id) => node(page, id).evaluate((button) => getComputedStyle(button).borderLeftColor)));
  expect(new Set(colors).size).toBe(3);
  for (const [source, target] of [[a.id, d.id], [a.id, e.id], [d.id, f.id], [e.id, f.id], [b.id, f.id], [c.id, f.id], [f.id, g.id]]) {
    const from = await node(page, source!).boundingBox();
    const to = await node(page, target!).boundingBox();
    expect(from).not.toBeNull(); expect(to).not.toBeNull();
    expect(from!.x + from!.width / 2).toBeLessThan(to!.x + to!.width / 2);
  }
  const paths = page.locator('.task-dependency-edges path.react-flow__edge-path');
  expect(await paths.evaluateAll((items) => items.every((path) => (path.getAttribute('marker-end') ?? '').startsWith('url(')))).toBe(true);
  expect(await paths.evaluateAll((items) => items.filter((path) => getComputedStyle(path).strokeDasharray !== 'none').length)).toBe(2);
  await root(page, b.id).click();
  await expect(root(page, a.id)).toHaveAttribute('aria-expanded', 'false');
  await expect(root(page, b.id)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.task-graph-canvas')).toHaveCount(1);
  await checkEdges(b.id);
  await page.reload();
  await expect(root(page, b.id)).toHaveAttribute('aria-expanded', 'true');
  await expect(root(page, a.id)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.task-graph-canvas')).toHaveCount(1);
  await checkEdges(b.id);
  await root(page, b.id).click();
  await expect(page.locator('.task-graph-canvas')).toHaveCount(0);
  await page.reload();
  await expect(root(page, a.id)).toHaveAttribute('aria-expanded', 'false');
  await expect(root(page, b.id)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.task-graph-canvas')).toHaveCount(0);
  await root(page, a.id).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(7);
  await checkEdges(a.id);
  await screenshot(page, info, 'project-graph');
});

test('detail-navigation', scenario('detail-navigation'), async ({ page, request }, info) => {
  const project = await createProject(request, { name: `Details ${randomUUID()}` });
  const a = await createTask(request, project.id, { title: '前置 <script>文本</script>', description: '前置说明' });
  await updateTask(request, project.id, a.id, { version: a.version, status: 'done' });
  const title = '完整标题 😀 '.repeat(24);
  const description = '第一行\n<img src=x onerror=alert(1)>\n<script>window.leaked=true</script>\n最后一行';
  const ownURL = new URL(`/projects/${project.id}`, info.project.use.baseURL as string).href;
  const pullRequests = [
    { title: '服务端关联', url: ownURL },
    { title: '', url: '' },
    { title: '  标题\n\t\0保留  ', url: '  arbitrary\n\t\0address  ' },
    { title: '<img src=x onerror=window.leaked=true>', url: '<script>window.leaked=true</script>' },
    { title: '脚本字符串', url: 'javascript:window.leaked=true' },
    { title: '数据字符串', url: 'data:text/html,<script>window.leaked=true</script>' },
    { title: '自定义协议', url: 'review:example/123' },
    { title: '相对引用', url: '/pull/123' },
    { title: '损坏地址', url: 'https://[' },
    { title: '服务端关联', url: ownURL },
    ...Array.from({ length: 190 }, (_, index) => ({ title: `保留序号 ${index + 11}`, url: `reference ${index + 11}` })),
    { title: '', url: '' },
    { title: '  后页\n\t\0原值  ', url: '  late arbitrary\0URL  ' },
    { title: '后页重复关联', url: ownURL },
    { title: '后页重复关联', url: ownURL },
    { title: '<img src=x onerror=window.leaked=true>', url: 'javascript:window.leaked=true' },
  ];
  const b = await createTask(request, project.id, { title, description, dependsOn: [a.id], properties: { pullRequests } });
  expect(b.properties.pullRequests).toEqual(pullRequests);
  const c = await createTask(request, project.id, { title: '快照中的后续', description: '后续描述', dependsOn: [b.id] });
  await openProject(page, project.id, project.name);
  const graphResponse = await request.get(`/api/v1/projects/${project.id}/task-graph`);
  expect(graphResponse.status()).toBe(200);
  const graph = await graphResponse.json() as { tasks: Record<string, unknown>[] };
  expect(graph.tasks.every((task) => !Object.hasOwn(task, 'properties'))).toBe(true);
  const unknown = await createTask(request, project.id, { title: '图快照外的新任务', description: '最新详情可读取' });
  await updateTask(request, project.id, b.id, { version: b.version, dependsOn: [a.id, unknown.id] });
  let detailReads = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === `/api/v1/projects/${project.id}/tasks/${b.id}`) detailReads++; });
  await node(page, b.id).click();
  const dialog = page.getByRole('dialog', { name: '任务详情' });
  await expect(dialog.locator('.drawer-title')).toHaveText(title);
  expect(await dialog.getByRole('region', { name: '描述', exact: true }).locator('.drawer-description').textContent()).toBe(description);
  await expect(dialog.locator('.drawer-full-id')).toHaveText(b.id);
  await expect(dialog.locator('time')).toHaveCount(2);
  await expect(dialog.locator('img,script')).toHaveCount(0);
  const properties = await checkPullRequests(dialog, pullRequests);
  const links = properties.getByRole('link');
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('href', ownURL);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  const opened = page.waitForEvent('popup');
  await links.first().click();
  const popup = await opened;
  try {
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toBe(ownURL);
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  } finally { await popup.close(); }
  expect(await page.evaluate(() => 'leaked' in window)).toBe(false);
  const pageSelection = properties.getByRole('combobox', { name: '关联 PR 页码' });
  const nextPage = properties.getByRole('button', { name: '下一页' });
  const previousPage = properties.getByRole('button', { name: '上一页' });
  await expect(previousPage).toBeDisabled();
  await nextPage.click();
  await checkPullRequests(dialog, pullRequests, 1);
  await nextPage.click();
  await checkPullRequests(dialog, pullRequests, 2);
  await expect(nextPage).toBeDisabled();
  await expect(pageSelection).toBeFocused();
  await previousPage.click();
  await checkPullRequests(dialog, pullRequests, 1);
  await pageSelection.selectOption('2');
  await checkPullRequests(dialog, pullRequests, 2);
  await pageSelection.selectOption('0');
  await checkPullRequests(dialog, pullRequests);
  expect(detailReads, 'Local pagination reads no additional task data').toBe(1);
  await pageSelection.selectOption('2');
  await checkPullRequests(dialog, pullRequests, 2);
  await page.keyboard.press('Tab');
  await expect(properties.getByRole('link').first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(pageSelection).toBeFocused();
  await expect(dialog.getByRole('region', { name: '前置依赖', exact: true }).getByRole('button', { name: a.title, exact: true })).toBeVisible();
  const unknownReference = dialog.getByRole('region', { name: '前置依赖', exact: true }).getByRole('button', { name: unknown.id, exact: true });
  await expect(unknownReference).toBeVisible();
  await expect(dialog.getByRole('region', { name: '任务图快照中的直接后续', exact: true }).getByRole('button', { name: c.title, exact: true })).toBeVisible();
  await dialog.getByRole('region', { name: '任务图快照中的直接后续', exact: true }).getByRole('button', { name: c.title, exact: true }).click();
  await expect(dialog.locator('.drawer-title')).toHaveText(c.title);
  await checkPullRequests(dialog, []);
  await expect(dialog.getByText('暂无关联 PR', { exact: true })).toBeVisible();
  await dialog.getByRole('region', { name: '前置依赖', exact: true }).getByRole('button', { name: `${Array.from(title).slice(0, 160).join('')}…`, exact: true }).click();
  await expect(dialog.locator('.drawer-title')).toHaveText(title);
  await checkPullRequests(dialog, pullRequests);
  await dialog.getByRole('region', { name: '前置依赖', exact: true }).getByRole('button', { name: unknown.id, exact: true }).click();
  await expect(dialog.locator('.drawer-title')).toHaveText(unknown.title);
  await expect(dialog.getByText('当前任务尚未包含在任务图中，请刷新任务图以查看后续关系。')).toBeVisible();
  await expect(stat(page, '任务总数')).toHaveText('3');
  await screenshot(page, info, 'detail-navigation');
});

test('refresh-staleness', scenario('refresh-staleness'), async ({ page, request }, info) => {
  const project = await createProject(request, { name: `Freshness ${randomUUID()}` });
  const predecessor = await createTask(request, project.id, { title: '完成后解除阻塞的前置' });
  const dependent = await createTask(request, project.id, { title: '版本和时间保持不变的后续', dependsOn: [predecessor.id] });
  await openProject(page, project.id, project.name);
  await expect(stat(page, '已完成')).toHaveText('0');
  await expect(stat(page, '被阻塞')).toHaveText('1');
  await expect(node(page, dependent.id).locator('.graph-blocked-badge')).toBeVisible();
  await updateTask(request, project.id, predecessor.id, { version: predecessor.version, status: 'done' });
  const currentResponse = await request.get(`/api/v1/projects/${project.id}/tasks/${dependent.id}`);
  expect(currentResponse.status()).toBe(200);
  const current = await currentResponse.json() as typeof dependent;
  expect(current.version).toBe(dependent.version);
  expect(current.updatedAt).toBe(dependent.updatedAt);
  expect(current.ready).toBe(true);
  expect(current.blockedBy).toEqual([]);
  await node(page, dependent.id).click();
  const dialog = page.getByRole('dialog', { name: '任务详情' });
  await expect(dialog.locator('.drawer-title')).toHaveText(dependent.title);
  await expect(dialog.locator('.drawer-ready')).toHaveText('可开始');
  await expect(dialog.getByText('任务详情与当前任务图不同，刷新后可查看一致的进度和关系。')).toBeVisible();
  await expect(stat(page, '已完成')).toHaveText('0');
  await expect(stat(page, '被阻塞')).toHaveText('1');
  const graphResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/projects/${project.id}/task-graph`);
  await dialog.getByRole('button', { name: '刷新任务图', exact: true }).click();
  expect((await graphResponse).status()).toBe(200);
  await expect(stat(page, '已完成')).toHaveText('1');
  await expect(stat(page, '被阻塞')).toHaveText('0');
  await expect(dialog.locator('.drawer-title')).toHaveText(dependent.title);
  await expect(dialog.locator('.drawer-stale')).toHaveCount(0);
  await expect(node(page, dependent.id).locator('.graph-blocked-badge')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const pullRequests = Array.from({ length: 205 }, (_, index) => ({ title: `刷新前关联 ${index + 1}`, url: '  new arbitrary URL\0  ' }));
  const changed = await updateTask(request, project.id, dependent.id, { version: current.version, properties: { pullRequests } });
  expect(changed.properties.pullRequests).toEqual(pullRequests);
  await node(page, dependent.id).click();
  await checkPullRequests(dialog, pullRequests);
  await expect(dialog.locator('.drawer-stale')).toBeVisible();
  await dialog.getByRole('combobox', { name: '关联 PR 页码' }).selectOption('2');
  await checkPullRequests(dialog, pullRequests, 2);
  const replacement = Array.from({ length: 101 }, (_, index) => ({ title: `刷新后关联 ${index + 1}`, url: 'arbitrary' }));
  await updateTask(request, project.id, dependent.id, { version: changed.version, properties: { pullRequests: replacement } });
  await dialog.getByRole('button', { name: '刷新任务图', exact: true }).click();
  await checkPullRequests(dialog, replacement);
  await expect(dialog.locator('.drawer-stale')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '关闭任务详情', exact: true })).toBeFocused();
  await screenshot(page, info, 'refresh-staleness');
});

test('failure-recovery', scenario('failure-recovery'), async ({ page, request }, info) => {
  const project = await createProject(request, { name: `Recovery ${randomUUID()}` });
  await openProject(page, project.id, project.name);
  await expect(page.getByRole('heading', { name: '还没有任务' })).toBeVisible();
  await expect(stat(page, '任务总数')).toHaveText('0');
  const task = await createTask(request, project.id, { title: '已经全部完成' });
  await updateTask(request, project.id, task.id, { version: task.version, status: 'done' });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(stat(page, '任务总数')).toHaveText('1');
  await expect(stat(page, '已完成')).toHaveText('1');
  await expect(page.getByText('完成比例 100%')).toBeVisible();
  await expect(root(page, task.id)).toHaveAttribute('aria-expanded', 'true');
  await expect(node(page, task.id)).toBeVisible();
  const receipt = await page.locator('.snapshot-time time').getAttribute('datetime');
  const dialog = page.getByRole('dialog', { name: '任务详情' });
  await withDependencyFailure(async () => {
    const failedDetail = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/projects/${project.id}/tasks/${task.id}`);
    await node(page, task.id).click();
    const response = await failedDetail;
    expect(response.status()).toBe(500);
    await expect(dialog.getByRole('heading', { name: '任务详情加载失败' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '重试详情', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '关闭任务详情', exact: true })).toBeFocused();
    await expect(page.locator('.task-graph-canvas')).toBeVisible();
    await expect(stat(page, '任务总数')).toHaveText('1');
    await expect(stat(page, '已完成')).toHaveText('1');
    await expect(page.locator('.snapshot-time time')).toHaveAttribute('datetime', receipt!);
    await expect(page.locator('.snapshot-error')).toHaveCount(0);
  });
  const retriedDetail = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/projects/${project.id}/tasks/${task.id}`);
  await dialog.getByRole('button', { name: '重试详情', exact: true }).click();
  expect((await retriedDetail).status()).toBe(200);
  await expect(dialog.locator('.drawer-title')).toHaveText(task.title);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '关闭任务详情', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(node(page, task.id)).toBeFocused();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await withDependencyFailure(async () => {
    const failed = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/projects/${project.id}/task-graph`);
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    const response = await failed;
    expect(response.status()).toBe(500);
    const body = await response.json() as { error: { requestId: string; code: string } };
    expect(body.error.code).toBe('internal_error');
    expect(response.headers()['x-request-id']).toBe(body.error.requestId);
    await info.attach('failure-request', { body: Buffer.from(JSON.stringify({ projectId: project.id, requestId: body.error.requestId, status: response.status() })), contentType: 'application/json' });
    await expect(page.getByRole('heading', { name: '刷新失败' })).toBeVisible();
    await expect(page.getByText('仍显示上次成功读取的数据。')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(body.error.requestId);
    await expect(stat(page, '任务总数')).toHaveText('1');
    await expect(stat(page, '已完成')).toHaveText('1');
    await expect(page.locator('.snapshot-time time')).toHaveAttribute('datetime', receipt!);
    await expect(page.getByRole('alert')).not.toContainText('task_dependencies');
    await page.reload();
    await expect(page.getByRole('heading', { name: '项目加载失败' })).toBeVisible();
    await expect(page.getByRole('region', { name: '项目任务统计' })).toHaveCount(0);
  });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  await expect(stat(page, '已完成')).toHaveText('1');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await screenshot(page, info, 'failure-recovery');
  await page.goto(`/projects/${randomUUID()}`);
  await expect(page.getByRole('heading', { name: '项目不存在' })).toBeVisible();
  await expect(page.getByRole('region', { name: '项目任务统计' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '返回项目列表' })).toBeVisible();
});

test('deep-links', scenario('deep-links'), async ({ page, request }, info) => {
  const first = await createProject(request, { name: `Route first ${randomUUID()}` });
  const second = await createProject(request, { name: `Route second ${randomUUID()}` });
  await createTask(request, first.id, { title: '首项目任务' });
  await createTask(request, second.id, { title: '次项目任务' });
  await openProject(page, first.id, first.name);
  const reload = await page.reload();
  expect(reload?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: first.name, exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← 项目', exact: true }).click();
  await loadAllProjects(page);
  await page.locator(`a.project-card[href="/projects/${second.id}"]`).click();
  await expect(page.getByRole('heading', { name: second.name, exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: second.name, exact: true })).toBeVisible();

  const fetched = deferred<void>();
  const release = deferred<void>();
  const pattern = `**/api/v1/projects/${first.id}/task-graph`;
  const aborted: string[] = [];
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname === `/api/v1/projects/${first.id}/task-graph`) aborted.push(request.failure()?.errorText ?? 'missing-error');
  });
  await page.route(pattern, async (route) => {
    const response = await route.fetch({ timeout: 15_000, maxRetries: 0 });
    expect(response.status()).toBe(200);
    fetched.resolve();
    await within(release.promise, 'delayed graph response release', 30_000);
    if (route.request().failure() !== null) await route.abort('aborted');
    else await route.fulfill({ response });
  });
  try {
    await page.evaluate((path) => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, `/projects/${first.id}`);
    await within(fetched.promise, 'real graph response fetch');
    await expect(page.getByRole('status', { name: '正在加载任务图' })).toBeVisible();
    await expect(page.getByRole('heading', { name: second.name, exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '项目任务统计' })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole('heading', { name: second.name, exact: true })).toBeVisible();
    await expect.poll(() => aborted.length).toBe(1);
    expect(aborted[0]).toMatch(/ABORT|cancel/i);
    await info.attach('navigation-cancellation', { body: Buffer.from(JSON.stringify({ projectId: first.id, nextProjectId: second.id, failure: aborted[0] })), contentType: 'application/json' });
  } finally {
    release.resolve();
    await within(page.unrouteAll({ behavior: 'wait' }), 'delayed graph route cleanup');
  }
  await expect(page.getByRole('heading', { name: second.name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: first.name, exact: true })).toHaveCount(0);
  await page.goto('/projects/not-a-uuid');
  await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible();
  await page.goto(`/projects/${second.id}`);
  await expect(page.getByRole('heading', { name: second.name, exact: true })).toBeVisible();
  await screenshot(page, info, 'deep-links');
});

test('keyboard-focus', scenario('keyboard-focus'), async ({ page, request }, info) => {
  const project = await createProject(request, { name: `Keyboard ${randomUUID()}` });
  const a = await createTask(request, project.id, { title: '键盘前置任务' });
  await updateTask(request, project.id, a.id, { version: a.version, status: 'done' });
  const b = await createTask(request, project.id, { title: '键盘选择任务', dependsOn: [a.id], properties: {
    pullRequests: [{ title: '键盘可访问的 PR', url: 'https://example.com/pull/123' }],
  } });
  const c = await createTask(request, project.id, { title: '键盘后续任务', dependsOn: [b.id] });
  await openProject(page, project.id, project.name);
  const trigger = node(page, b.id);
  let detailReads = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === `/api/v1/projects/${project.id}/tasks/${b.id}`) detailReads++; });
  await page.keyboard.press('Tab');
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '任务详情' });
  const close = dialog.getByRole('button', { name: '关闭任务详情', exact: true });
  await expect(dialog.locator('.drawer-title')).toHaveText(b.title);
  expect(detailReads).toBe(1);
  await expect(close).toBeFocused();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('link', { name: b.properties.pullRequests[0]!.url, exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('region', { name: '任务图快照中的直接后续', exact: true }).getByRole('button', { name: c.title, exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  for (let index = 0; index < 9; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Space');
  await expect(dialog.locator('.drawer-title')).toHaveText(b.title);
  expect(detailReads).toBe(2);
  await close.click();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog.locator('.drawer-title')).toHaveText(b.title);
  const fetched = deferred<void>();
  const release = deferred<void>();
  const pattern = `**/api/v1/projects/${project.id}/tasks/${a.id}`;
  await page.route(pattern, async (route) => {
    const response = await route.fetch({ timeout: 15_000, maxRetries: 0 });
    expect(response.status()).toBe(200);
    fetched.resolve();
    await within(release.promise, 'delayed task response release', 30_000);
    if (route.request().failure() !== null) await route.abort('aborted');
    else await route.fulfill({ response });
  });
  try {
    await dialog.getByRole('region', { name: '前置依赖', exact: true }).getByRole('button', { name: a.title, exact: true }).click();
    await within(fetched.promise, 'real task response fetch');
    await expect(dialog.getByText('正在加载任务详情', { exact: true })).toBeVisible();
    await expect(close).toBeFocused();
    expect(await trigger.evaluate((button) => button === document.activeElement)).toBe(false);
    release.resolve();
    await expect(dialog.locator('.drawer-title')).toHaveText(a.title);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  } finally {
    release.resolve();
    await within(page.unrouteAll({ behavior: 'wait' }), 'delayed task route cleanup');
  }
  await trigger.click();
  await expect(dialog.locator('.drawer-title')).toHaveText(b.title);
  await page.locator('.drawer-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await updateTask(request, project.id, b.id, { version: b.version, dependsOn: [] });
  await trigger.click();
  await expect(dialog.locator('.drawer-stale')).toBeVisible();
  await dialog.getByRole('button', { name: '刷新任务图', exact: true }).click();
  await expect(dialog.locator('.drawer-title')).toHaveText(b.title);
  await expect(trigger).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(root(page, a.id)).toBeFocused();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await screenshot(page, info, 'keyboard-focus');
});

test('narrow-layout', scenario('narrow-layout'), async ({ page, request }, info) => {
  const project = await createProject(request, { name: `窄屏项目 ${'很长的项目名称😀'.repeat(12)}` });
  const pullRequests = [
    { title: '  多行标题\n第二行\t\0  ', url: `https://example.com/${'long-path-'.repeat(500)}` },
    { title: '很长的 PR 标题😀'.repeat(150), url: '   '.repeat(500) },
    { title: '', url: '' },
    ...Array.from({ length: 98 }, (_, index) => ({ title: `窄屏关联 ${index + 4}`, url: `reference ${index + 4}` })),
  ];
  const a = await createTask(request, project.id, { title: `窄屏根 ${'很长的任务标题😀'.repeat(30)}`, description: '长描述 <img src=x>\n'.repeat(40), properties: { pullRequests } });
  await createTask(request, project.id, { title: '后续任务', dependsOn: [a.id] });
  await page.setViewportSize({ width: 320, height: 800 });
  await openProject(page, project.id, project.name);
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('.stats .stat')).toHaveCount(6);
  await page.keyboard.press('Tab');
  await node(page, a.id).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '任务详情' });
  await expect(dialog.locator('.drawer-title')).toHaveText(a.title);
  await expect(dialog.locator('.drawer-description').first()).toHaveText(a.description);
  await checkPullRequests(dialog, pullRequests);
  await dialog.getByRole('combobox', { name: '关联 PR 页码' }).selectOption('1');
  await checkPullRequests(dialog, pullRequests, 1);
  await dialog.getByRole('button', { name: '上一页' }).click();
  await checkPullRequests(dialog, pullRequests);
  await expect(dialog.getByRole('combobox', { name: '关联 PR 页码' })).toBeFocused();
  for (const width of [320, 768, 1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(async () => {
      const bounds = await dialog.boundingBox();
      return bounds !== null && bounds.x >= -0.5 && bounds.x + bounds.width <= width + 0.5 && bounds.y >= -0.5 && bounds.height <= 800.5;
    }).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await dialog.locator('.drawer-body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
  }
  await dialog.getByRole('button', { name: '关闭任务详情', exact: true }).focus();
  await expect(dialog.getByRole('button', { name: '关闭任务详情', exact: true })).toBeFocused();
  await screenshot(page, info, 'narrow-layout');
});
