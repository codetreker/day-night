import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { evidenceDirectory, expect, test, updateTask } from './fixtures';
import { seedCapacity, seedNodeLimit, type CapacityFixture, type CapacityKind } from './capacity-data';
import { withCapacityTrace } from './capacity-trace';
import { checkDependencyGeometry, type GeometryExpectation } from './dependency-geometry';

// Repeated DOM snapshots of complete capacity graphs add controller work between
// measured interactions. Dedicated CDP timelines and scenario PNGs retain the
// rendering evidence alongside Playwright's action and network trace.
test.use({ trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false } });

type ExpansionMeasurement = { openMs: number; layoutMs: number; renderMs: number };
type Measurement = ExpansionMeasurement & { selectMs: number; detailMs: number; detailNetworkMs: number; zoomMs: number; panMs: number };
type Dataset = {
  scenario: string; nodes: 1000; edges: number; result: 'running' | 'passed' | 'failed';
  networkMs?: number; coldOpenMs?: number; measurements: Measurement[]; feedbackDiagnostics: FeedbackDiagnostic[]; error?: string;
  controllerDurations: { fixtureMs?: number; snapshotMs?: number; repetitions: { interactionMs: number; totalMs: number }[] };
};
type Limit = { status: number; nodeCount: number; edgeCount: number; maxNodes: number; maxEdges: number };
const receipt: {
  schemaVersion: 1; result: 'running' | 'passed' | 'failed'; datasets: Dataset[];
  limits: { node?: Limit; edge?: Limit };
  timing: { start: string; end: string; panStart: string };
} = {
  schemaVersion: 1, result: 'running', datasets: [], limits: {},
  timing: {
    start: 'trusted browser input event.timeStamp', end: 'DOM condition and two requestAnimationFrame callbacks',
    panStart: 'first primary-button pointermove',
  },
};
let mergeFixture: CapacityFixture | undefined;

const persist = async () => {
  const path = join(evidenceDirectory(), 'performance.json');
  await mkdir(evidenceDirectory(), { recursive: true });
  await writeFile(`${path}.next`, `${JSON.stringify(receipt, null, 2)}\n`);
  await rename(`${path}.next`, path);
};

const withScreenshot = async (page: Page, info: TestInfo, name: string, operation: () => Promise<void>) => {
  let failure: unknown;
  try { await operation(); } catch (error) { failure = error; }
  try {
    const path = join(evidenceDirectory(), `${name}.png`);
    await page.screenshot({ path, fullPage: false });
    await info.attach(name, { path, contentType: 'image/png' });
  } catch (error) {
    failure = failure === undefined ? error : new AggregateError([failure, error], 'Capacity scenario and screenshot both failed.');
  }
  if (failure !== undefined) throw failure;
};

const painted = (page: Page) => page.evaluate(() => new Promise<number>((resolve) => {
  requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(performance.now()); }); });
}));
const transform = (page: Page) => page.locator('.react-flow__viewport').evaluate((element) => (element as HTMLElement).style.transform);

type TimingCondition =
  | { kind: 'open'; rootId: string; edges: number; upstream: boolean }
  | { kind: 'select'; rootId: string }
  | { kind: 'detail'; rootId: string }
  | { kind: 'zoom' | 'pan'; previousTransform: string };
type BrowserTiming = {
  status: 'armed' | 'running' | 'finished' | 'failed'; start: number | null;
  capturedAt: number | null; conditionAt: number | null; frame1At: number | null; frame2At: number | null;
  end: number | null; error: string | null; cleanup: () => void;
};
type FeedbackDiagnostic = {
  key: string; kind: TimingCondition['kind']; repetition: number; status: BrowserTiming['status'];
  start: number | null; capturedAt: number | null; conditionAt: number | null; frame1At: number | null; frame2At: number | null;
  end: number | null; error: string | null;
  phases: { inputQueueMs: number | null; conditionMs: number | null; firstFrameMs: number | null; secondFrameMs: number | null };
};
type TimingWindow = Window & { __daynightCapacityTiming?: Record<string, BrowserTiming> };
let timingSequence = 0;

const measureBrowserFeedback = async (page: Page, condition: TimingCondition, action: () => Promise<void>, dataset: Dataset, repetition: number) => {
  const key = `${dataset.scenario}:repetition-${repetition}:${condition.kind}:${++timingSequence}`;
  await page.evaluate(({ key, condition }) => {
    const host = window as TimingWindow;
    if (host.__daynightCapacityTiming === undefined) host.__daynightCapacityTiming = {};
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    let finishing = false;
    let countsDirty = true;
    let countsReady = false;
    const state: BrowserTiming = {
      status: 'armed', start: null, capturedAt: null, conditionAt: null, frame1At: null, frame2At: null, end: null, error: null,
      cleanup: () => {
        observer.disconnect();
        document.removeEventListener(eventType, start, true);
        if (firstFrame !== null) cancelAnimationFrame(firstFrame);
        if (secondFrame !== null) cancelAnimationFrame(secondFrame);
      },
    };
    host.__daynightCapacityTiming[key] = state;

    const ready = (): boolean => {
      if (condition.kind === 'select') return document.querySelector(`.react-flow__node[data-id="${condition.rootId}"] .task-node[data-inspection="selected"] .task-node-body[aria-pressed="true"]`) !== null;
      if (condition.kind === 'detail') {
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog === null) return false;
        const bounds = dialog.getBoundingClientRect();
        const style = getComputedStyle(dialog);
        return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      }
      const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
      if (viewport === null) return false;
      if (condition.kind !== 'open') return viewport.style.transform !== condition.previousTransform;
      if (countsDirty) {
        const svg = document.querySelector<SVGSVGElement>('.task-dependency-edges');
        const expectedPaintPieces = svg?.getAttribute('data-paint-piece-count');
        const validPaintCount = expectedPaintPieces !== null && expectedPaintPieces !== undefined
          && /^(0|[1-9]\d*)$/.test(expectedPaintPieces) && Number.isSafeInteger(Number(expectedPaintPieces));
        countsReady = document.querySelectorAll('.react-flow__node').length === 1000
          && document.querySelectorAll('.react-flow__node .task-node').length === 1000
          && document.querySelectorAll('.react-flow__edge-path').length === condition.edges
          && validPaintCount && svg!.querySelectorAll('.task-dependency-paint-piece').length === Number(expectedPaintPieces);
        countsDirty = false;
      }
      if (!countsReady) return false;
      const canvas = document.querySelector('.task-graph-canvas');
      const source = condition.upstream
        ? [...document.querySelectorAll<HTMLElement>('.react-flow__node')].reduce((first, node) => {
          const position = /translate\(([^,]+)px,\s*([^)]+)px\)/.exec(node.style.transform)!;
          const previous = /translate\(([^,]+)px,\s*([^)]+)px\)/.exec(first.style.transform)!;
          return Number(position[1]) < Number(previous[1]) || Number(position[1]) === Number(previous[1]) && Number(position[2]) < Number(previous[2]) ? node : first;
        }).querySelector('.task-node')
        : document.querySelector(`.react-flow__node[data-id="${condition.rootId}"] .task-node`);
      if (canvas === null || source === null) return false;
      const bounds = canvas.getBoundingClientRect();
      const node = source.getBoundingClientRect();
      const zoom = Number(/scale\(([^)]+)\)/.exec(viewport.style.transform)?.[1]);
      return zoom >= 0.8 && zoom <= 1 && node.left >= bounds.left && node.top >= bounds.top
        && node.right <= bounds.right && node.bottom <= bounds.bottom;
    };
    const check = () => {
      if (state.status !== 'running' || finishing) return;
      try {
        if (!ready()) return;
        if (state.conditionAt === null) {
          state.conditionAt = performance.now();
          performance.mark(`daynight:${key}:condition`, { startTime: state.conditionAt });
        }
        finishing = true;
        firstFrame = requestAnimationFrame(() => {
          if (state.frame1At === null) {
            state.frame1At = performance.now();
            performance.mark(`daynight:${key}:raf1`, { startTime: state.frame1At });
          }
          secondFrame = requestAnimationFrame(() => {
            if (state.frame2At === null) {
              state.frame2At = performance.now();
              performance.mark(`daynight:${key}:raf2`, { startTime: state.frame2At });
            }
            try {
              finishing = false;
              if (!ready()) return;
              state.end = performance.now();
              performance.mark(`daynight:${key}:end`, { startTime: state.end });
              state.status = 'finished';
              state.cleanup();
            } catch (error) {
              state.status = 'failed';
              state.error = error instanceof Error ? error.message : 'Browser feedback observer failed.';
              state.cleanup();
            }
          });
        });
      } catch (error) {
        state.status = 'failed';
        state.error = error instanceof Error ? error.message : 'Browser feedback observer failed.';
        state.cleanup();
      }
    };
    const eventType = condition.kind === 'pan' ? 'pointermove' : 'click';
    const start = (event: Event) => {
      if (state.status !== 'armed' || !event.isTrusted || !(event.target instanceof Element)) return;
      const selector = condition.kind === 'open' ? `#task-root-${condition.rootId}`
        : condition.kind === 'detail' ? `.react-flow__node[data-id="${condition.rootId}"] .task-node-details`
          : condition.kind === 'select' ? `.react-flow__node[data-id="${condition.rootId}"] .task-node-body`
          : condition.kind === 'zoom' ? '.react-flow__controls-zoomin' : '.react-flow__pane';
      if (event.target.closest(selector) === null) return;
      if (condition.kind === 'pan' && (!(event instanceof PointerEvent) || event.buttons !== 1 || !event.isPrimary)) return;
      const capturedAt = performance.now();
      if (!Number.isFinite(event.timeStamp) || event.timeStamp < 0 || event.timeStamp > capturedAt) {
        state.status = 'failed';
        state.error = 'Trusted browser input timestamp does not use the performance clock.';
        state.cleanup();
        return;
      }
      state.start = event.timeStamp;
      state.capturedAt = capturedAt;
      performance.mark(`daynight:${key}:event`, { startTime: state.start });
      performance.mark(`daynight:${key}:capture`, { startTime: capturedAt });
      state.status = 'running';
      queueMicrotask(check);
    };
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === 'childList')) countsDirty = true;
      check();
    });
    const target = condition.kind === 'open' ? document.getElementById(`task-root-${condition.rootId}`)!.closest('.root-row')!
      : condition.kind === 'detail' ? document.body : document.querySelector('.react-flow__viewport')!;
    observer.observe(target, condition.kind === 'detail' ? { childList: true, subtree: true } : {
      childList: condition.kind === 'open', subtree: condition.kind === 'open' || condition.kind === 'select',
      attributes: true, attributeFilter: condition.kind === 'select' ? ['data-inspection', 'aria-pressed', 'class'] : ['style'],
    });
    document.addEventListener(eventType, start, true);
  }, { key, condition });
  let original: unknown;
  try {
    await action();
    await page.waitForFunction((key) => {
      const state = (window as TimingWindow).__daynightCapacityTiming?.[key];
      return state?.status === 'finished' || state?.status === 'failed';
    }, key);
    const result = await page.evaluate((key) => {
      const state = (window as TimingWindow).__daynightCapacityTiming![key]!;
      return { start: state.start, capturedAt: state.capturedAt, end: state.end, error: state.error };
    }, key);
    if (result.error !== null || result.start === null || result.capturedAt === null || result.end === null) {
      throw new Error(result.error ?? 'Browser feedback timing is incomplete.');
    }
    expect(result.capturedAt).toBeGreaterThanOrEqual(result.start);
    expect(result.end).toBeGreaterThanOrEqual(result.capturedAt);
    return { start: result.start, end: result.end, duration: result.end - result.start };
  } catch (error) {
    original = error;
    throw error;
  } finally {
    let diagnosticsFailure: unknown;
    try {
      const diagnostic = await page.evaluate((key) => {
        const state = (window as TimingWindow).__daynightCapacityTiming![key]!;
        const difference = (end: number | null, start: number | null): number | null => end === null || start === null ? null : end - start;
        return {
          status: state.status, start: state.start, capturedAt: state.capturedAt, conditionAt: state.conditionAt,
          frame1At: state.frame1At, frame2At: state.frame2At, end: state.end, error: state.error,
          phases: { inputQueueMs: difference(state.capturedAt, state.start), conditionMs: difference(state.conditionAt, state.capturedAt),
            firstFrameMs: difference(state.frame1At, state.conditionAt), secondFrameMs: difference(state.frame2At, state.frame1At) },
        };
      }, key);
      dataset.feedbackDiagnostics.push({ key, kind: condition.kind, repetition, ...diagnostic });
      await persist();
    } catch (error) { diagnosticsFailure = error; }
    try {
      await page.evaluate((key) => {
        const host = window as TimingWindow;
        host.__daynightCapacityTiming?.[key]?.cleanup();
        delete host.__daynightCapacityTiming?.[key];
      }, key);
    } catch (error) {
      diagnosticsFailure = diagnosticsFailure === undefined ? error : new AggregateError([diagnosticsFailure, error], 'Browser feedback diagnostics and observer cleanup failed.');
    }
    if (diagnosticsFailure !== undefined) {
      if (original !== undefined) throw new AggregateError([original, diagnosticsFailure], 'Browser feedback measurement and diagnostics failed.');
      throw diagnosticsFailure;
    }
  }
};

const visibleGraph = async (page: Page, rootId: string, edges: number, upstream: boolean) => {
  await expect(page.locator('.react-flow__node')).toHaveCount(1000);
  await expect(page.locator('.react-flow__node .task-node')).toHaveCount(1000);
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(edges);
  await page.waitForFunction(({ id, upstream }) => {
    const svg = document.querySelector<SVGSVGElement>('.task-dependency-edges');
    const expectedPaintPieces = svg?.getAttribute('data-paint-piece-count');
    if (expectedPaintPieces === null || expectedPaintPieces === undefined || !/^(0|[1-9]\d*)$/.test(expectedPaintPieces)
      || !Number.isSafeInteger(Number(expectedPaintPieces)) || svg!.querySelectorAll('.task-dependency-paint-piece').length !== Number(expectedPaintPieces)) return false;
    const canvas = document.querySelector('.task-graph-canvas');
    const source = upstream
      ? [...document.querySelectorAll<HTMLElement>('.react-flow__node')].reduce((first, node) => {
        const position = /translate\(([^,]+)px,\s*([^)]+)px\)/.exec(node.style.transform)!;
        const previous = /translate\(([^,]+)px,\s*([^)]+)px\)/.exec(first.style.transform)!;
        return Number(position[1]) < Number(previous[1]) || Number(position[1]) === Number(previous[1]) && Number(position[2]) < Number(previous[2]) ? node : first;
      }).querySelector('.task-node')
      : document.querySelector(`.react-flow__node[data-id="${id}"] .task-node`);
    if (canvas === null || source === null) return false;
    const bounds = canvas.getBoundingClientRect();
    const node = source.getBoundingClientRect();
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
    const zoom = Number(/scale\(([^)]+)\)/.exec(viewport.style.transform)?.[1]);
    return zoom >= 0.8 && zoom <= 1 && node.left >= bounds.left && node.top >= bounds.top
      && node.right <= bounds.right && node.bottom <= bounds.bottom;
  }, { id: rootId, upstream });
  return painted(page);
};

const panPoint = (page: Page) => page.evaluate(() => {
  const canvas = document.querySelector('.task-graph-canvas')!;
  const bounds = canvas.getBoundingClientRect();
  for (let y = bounds.top + 16; y < bounds.bottom - 50; y += 24) {
    for (let x = bounds.left + 16; x < bounds.right - 70; x += 24) {
      const target = document.elementFromPoint(x, y);
      if (target?.closest('.react-flow__pane') !== null && target?.closest('.task-node,.react-flow__controls,.react-flow__attribution') === null) return { x, y };
    }
  }
  throw new Error('No accessible blank canvas position is available for the pan interaction.');
});

const expectedCapacityGeometry = (fixture: CapacityFixture): GeometryExpectation => {
  const successors = new Map(fixture.tasks.map((task) => [task.id, [] as string[]]));
  for (const task of fixture.tasks) for (const source of task.dependsOn) successors.get(source)!.push(task.id);
  const main = new Set([fixture.root.id]); const pending = [fixture.root.id];
  for (let i = 0; i < pending.length; i++) for (const id of successors.get(pending[i]!)!) if (!main.has(id)) { main.add(id); pending.push(id); }
  return { nodes: fixture.tasks.map(({ id }) => ({ id })), edges: fixture.tasks.flatMap((task) => task.dependsOn.map((source) => ({
    id: `${source}->${task.id}`, source, target: task.id, external: !main.has(source),
  }))) };
};
const stableGeometry = (page: Page) => page.evaluate(() => ({
  viewport: (document.querySelector('.react-flow__viewport') as HTMLElement).style.transform,
  nodes: [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => [node.dataset.id, node.style.transform, node.style.width, node.style.height]),
  paths: [...document.querySelectorAll('.react-flow__edge-path')].map((path) => [path.getAttribute('data-source'), path.getAttribute('data-target'), path.getAttribute('d')]),
  pieces: [...document.querySelectorAll('.task-dependency-paint-piece')].map((piece) => ['d', 'transform', 'x1', 'x2', 'y1', 'y2'].map((attribute) => piece.getAttribute(attribute))),
}));
const assertInspection = async (page: Page, fixture: CapacityFixture, selectedId: string) => {
  const tasks = new Map(fixture.tasks.map((task) => [task.id, task]));
  const closure = new Set([selectedId]); const pending = [selectedId];
  while (pending.length > 0) for (const id of tasks.get(pending.pop()!)!.dependsOn) if (!closure.has(id)) { closure.add(id); pending.push(id); }
  const actual = await page.evaluate(() => ({
    nodes: [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => ({ id: node.dataset.id!, state: node.querySelector<HTMLElement>('.task-node')!.dataset.inspection,
      pressed: node.querySelector('.task-node-body')!.getAttribute('aria-pressed'), background: getComputedStyle(node.querySelector('.task-node')!).backgroundColor })),
    edges: [...document.querySelectorAll<SVGGElement>('.task-dependency-edge')].map((edge) => ({ id: edge.dataset.id!, target: edge.querySelector<SVGPathElement>('.react-flow__edge-path')!.dataset.target!, state: edge.dataset.inspection, color: getComputedStyle(edge).color, marker: edge.querySelector('.react-flow__edge-path')!.getAttribute('marker-end') })),
  }));
  expect(actual.nodes).toHaveLength(fixture.tasks.length);
  for (const node of actual.nodes) { expect(node.state, node.id).toBe(node.id === selectedId ? 'selected' : closure.has(node.id) ? 'prerequisite' : 'unrelated'); expect(node.pressed, node.id).toBe(String(node.id === selectedId)); expect(node.background, node.id).toBe(node.id === selectedId ? 'rgb(240, 239, 255)' : closure.has(node.id) ? 'rgb(247, 246, 255)' : 'rgb(249, 250, 252)'); }
  expect(actual.edges).toHaveLength(fixture.edgeCount);
  for (const edge of actual.edges) {
    const highlighted = closure.has(edge.target);
    expect(edge.state, edge.id).toBe(highlighted ? 'highlighted' : 'unrelated');
    expect(edge.color, edge.id).toBe(highlighted ? 'rgb(103, 98, 206)' : 'rgb(199, 205, 219)');
    expect(edge.marker, edge.id).toMatch(highlighted ? /-highlighted\)$/ : /-unrelated\)$/);
  }
};

type LocalFeedback = { detailMs: number; detailNetworkMs: number; zoomMs: number; panMs: number };
const measureDetailsZoomPan = async (page: Page, fixture: CapacityFixture, taskId: string, dataset: Dataset, repetition: number): Promise<LocalFeedback> => {
  const dialog = page.locator('.drawer-backdrop').getByRole('dialog');
  const detailResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/projects/${fixture.project.id}/tasks/${taskId}`));
  const detail = await measureBrowserFeedback(page, { kind: 'detail', rootId: taskId }, () =>
    page.locator(`.react-flow__node[data-id="${taskId}"] .task-node-details`).click(), dataset, repetition);
  await expect(dialog).toBeVisible();
  const response = await detailResponse;
  expect(response.status()).toBe(200);
  await response.finished();
  const timing = response.request().timing();
  const detailNetworkMs = timing.responseEnd - timing.requestStart;
  await expect(page.locator('.drawer-title')).toHaveText(fixture.tasks.find((task) => task.id === taskId)!.title);
  await dialog.locator('.drawer-header').getByRole('button', { name: '关闭任务详情', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const beforeZoom = await transform(page);
  const zoom = await measureBrowserFeedback(page, { kind: 'zoom', previousTransform: beforeZoom }, () =>
    page.locator('.react-flow__controls').getByRole('button', { name: '放大', exact: true }).click(), dataset, repetition);

  const point = await panPoint(page);
  await page.mouse.move(point.x, point.y);
  const beforePan = await transform(page);
  const pan = await measureBrowserFeedback(page, { kind: 'pan', previousTransform: beforePan }, async () => {
    await page.mouse.down();
    try { await page.mouse.move(point.x + 40, point.y + 24); }
    finally { await page.mouse.up(); }
  }, dataset, repetition);
  return { detailMs: detail.duration, detailNetworkMs, zoomMs: zoom.duration, panMs: pan.duration };
};

const measureInteractions = async (page: Page, fixture: CapacityFixture, expansion: ExpansionMeasurement, dataset: Dataset, repetition: number): Promise<Measurement> => {
  const expected = expectedCapacityGeometry(fixture);
  if (repetition === 0) expect(await checkDependencyGeometry(page, expected), 'Every normal dependency has independent complete geometry').toEqual([]);
  const initialDetailTask = fixture.kind === 'external' ? await page.locator('.task-node-external').evaluateAll((nodes) => {
    const canvas = document.querySelector('.task-graph-canvas')!.getBoundingClientRect();
    const visible = nodes.find((node) => { const bounds = node.getBoundingClientRect(); return bounds.left >= canvas.left && bounds.top >= canvas.top && bounds.right <= canvas.right && bounds.bottom <= canvas.bottom; });
    if (visible === undefined) throw new Error('The initial external prerequisite is not accessible.');
    return visible.closest('.react-flow__node')!.getAttribute('data-id')!;
  }) : fixture.root.id;
  // Keep the original raster-regression sequence at its initial viewport.
  const normal = await measureDetailsZoomPan(page, fixture, initialDetailTask, dataset, repetition);

  // Revealing the sink through the production keyboard-focus path happens before
  // timing. Its click exercises the deep upstream closure at the current view.
  const selectedId = fixture.tasks.at(-1)!.id;
  const body = page.locator(`.react-flow__node[data-id="${selectedId}"] .task-node-body`);
  await page.keyboard.press('Tab');
  await body.focus();
  await painted(page);
  const beforeSelection = await stableGeometry(page);
  const selection = await measureBrowserFeedback(page, { kind: 'select', rootId: selectedId }, () => body.click(), dataset, repetition);
  await assertInspection(page, fixture, selectedId);
  expect(await stableGeometry(page), 'Selecting upstream dependencies changes no node, route, paint-piece geometry or viewport').toEqual(beforeSelection);
  if (repetition === 4) expect(await checkDependencyGeometry(page, expected), 'Every highlighted dependency, arrow and external curve preserves complete native paint').toEqual([]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const highlighted = await measureDetailsZoomPan(page, fixture, selectedId, dataset, repetition);
  await assertInspection(page, fixture, selectedId);
  return { ...expansion, selectMs: selection.duration,
    detailMs: Math.max(normal.detailMs, highlighted.detailMs), detailNetworkMs: Math.max(normal.detailNetworkMs, highlighted.detailNetworkMs),
    zoomMs: Math.max(normal.zoomMs, highlighted.zoomMs), panMs: Math.max(normal.panMs, highlighted.panMs) };
};

const checkMeasurement = (measurement: Measurement) => {
  for (const value of Object.values(measurement)) {
    expect(Number.isFinite(value), 'Measured browser duration is finite').toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
  expect(measurement.openMs, 'Collapsed root opens within the supported capacity budget').toBeLessThanOrEqual(3000);
  expect(measurement.selectMs, 'Dependency selection has visible local feedback within budget').toBeLessThanOrEqual(300);
  expect(measurement.detailMs, 'Details has visible local feedback within budget').toBeLessThanOrEqual(300);
  expect(measurement.zoomMs, 'Zoom has visible feedback within budget').toBeLessThanOrEqual(300);
  expect(measurement.panMs, 'Pan has visible feedback within budget').toBeLessThanOrEqual(300);
};

test.describe('fixed capacity and performance @capacity', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(persist);
  test.afterAll(async () => {
    receipt.result = receipt.result !== 'failed' && receipt.datasets.length === 4
      && receipt.datasets.every((dataset) => dataset.result === 'passed' && dataset.measurements.length === 5)
      && receipt.limits.node !== undefined && receipt.limits.edge !== undefined ? 'passed' : 'failed';
    await persist();
  });

  for (const kind of ['chain', 'merge', 'shared', 'external'] as const satisfies readonly CapacityKind[]) {
    const scenario = `capacity-${kind}`;
    test(`renders and operates the complete ${kind} capacity graph`, { annotation: { type: 'scenario', description: scenario } }, async ({ page, request }, info) => {
      test.setTimeout(240_000);
      const dataset: Dataset = { scenario, nodes: 1000, edges: kind === 'chain' ? 999 : 5000, result: 'running', measurements: [], feedbackDiagnostics: [],
        controllerDurations: { repetitions: [] } };
      receipt.datasets.push(dataset);
      await persist();
      try {
        await withScreenshot(page, info, scenario, async () => {
          const fixtureStart = performance.now();
          const fixture = await seedCapacity(request, kind);
          dataset.controllerDurations.fixtureMs = performance.now() - fixtureStart;
          if (kind === 'merge') mergeFixture = fixture;
          expect(fixture.tasks).toHaveLength(1000);
          if (kind === 'chain') {
            expect(fixture.tasks.slice(1).map((task) => task.dependsOn)).toEqual(fixture.tasks.slice(0, -1).map((task) => [task.id]));
          }
          if (kind === 'external') {
            expect(fixture.tasks.filter((task) => task.dependsOn.includes(fixture.root.id))).toHaveLength(1);
            expect(fixture.tasks.at(-1)!.dependsOn).toHaveLength(108);
          }
          const snapshotStart = performance.now();
          const snapshot = await request.get(`/api/v1/projects/${fixture.project.id}/task-graph`);
          expect(snapshot.status()).toBe(200);
          const graph = await snapshot.json() as { summary: { total: number }; tasks: { id: string; dependsOn: string[] }[] };
          expect(graph.summary.total).toBe(1000);
          expect(graph.tasks).toHaveLength(1000);
          expect(new Set(graph.tasks.map((task) => task.id)).size).toBe(1000);
          expect(graph.tasks.reduce((count, task) => count + task.dependsOn.length, 0)).toBe(dataset.edges);
          expect(new Map(graph.tasks.map((task) => [task.id, [...task.dependsOn].sort()]))).toEqual(
            new Map(fixture.tasks.map((task) => [task.id, [...task.dependsOn].sort()])),
          );
          dataset.controllerDurations.snapshotMs = performance.now() - snapshotStart;
          let graphRequests = 0;
          const trackGraph = (request: { url: () => string }) => { if (request.url().endsWith(`/api/v1/projects/${fixture.project.id}/task-graph`)) graphRequests++; };
          page.on('request', trackGraph);
          const graphResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/projects/${fixture.project.id}/task-graph`));
          const coldStart = performance.now();
          await page.goto(`/projects/${fixture.project.id}`, { waitUntil: 'domcontentloaded' });
          if (kind === 'shared' || kind === 'external') await page.locator(`#task-root-${fixture.root.id}`).click();
          await visibleGraph(page, fixture.root.id, dataset.edges, kind === 'external');
          if (kind === 'external') {
            await expect(page.locator('.task-node-external')).toHaveCount(998);
            await expect(page.getByText('2 个链内任务 · 998 个外部前置 · 5000 条依赖')).toBeVisible();
            await expect(page.locator(`#task-root-${fixture.root.id} .root-progress-label`)).toHaveText('0/2 已完成');
          }
          dataset.coldOpenMs = performance.now() - coldStart;
          const initialResponse = await graphResponse;
          expect(initialResponse.status()).toBe(200);
          await initialResponse.finished();
          dataset.networkMs = await page.evaluate((url) => {
            const entries = performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[];
            if (entries.length !== 1) throw new Error('Expected one task graph network resource timing.');
            return entries[0]!.duration;
          }, initialResponse.url());
          expect(Number.isFinite(dataset.networkMs)).toBe(true);
          expect(dataset.networkMs).toBeGreaterThanOrEqual(0);
          const root = page.locator(`#task-root-${fixture.root.id}`);
          for (let repetition = 0; repetition < 5; repetition++) {
            await expect(root).toHaveAttribute('aria-expanded', 'true');
            await root.click();
            await expect(page.locator('.task-graph-canvas')).toHaveCount(0);
            await expect(root).toHaveAttribute('aria-expanded', 'false');
            await root.scrollIntoViewIfNeeded();
            const repetitionStart = performance.now();
            let interactionMs!: number;
            await withCapacityTrace(page, info, `${scenario}-repetition-${repetition}`, async () => {
              const interactionStart = performance.now();
              const opened = await measureBrowserFeedback(page, { kind: 'open', rootId: fixture.root.id, edges: dataset.edges, upstream: kind === 'external' }, () => root.click(), dataset, repetition);
              const expansion = await page.evaluate(({ rootId, start, paintedTime }) => {
                const measures = (performance.getEntriesByName('daynight:task-layout', 'measure') as PerformanceMeasure[])
                  .filter((measure) => measure.detail?.rootId === rootId && measure.startTime >= start);
                if (measures.length !== 1) throw new Error('Expected exactly one layout measurement for this collapsed root expansion.');
                const measure = measures[0]!;
                return {
                  openMs: paintedTime - start,
                  layoutMs: measure.duration,
                  renderMs: paintedTime - (measure.startTime + measure.duration),
                };
              }, { rootId: fixture.root.id, start: opened.start, paintedTime: opened.end });
              const measurement = await measureInteractions(page, fixture, expansion, dataset, repetition);
              dataset.measurements.push(measurement);
              await persist();
              checkMeasurement(measurement);
              interactionMs = performance.now() - interactionStart;
            });
            dataset.controllerDurations.repetitions.push({ interactionMs, totalMs: performance.now() - repetitionStart });
            await persist();
          }
          expect(graphRequests, 'Collapse and reopen reuse the complete project snapshot').toBe(1);
          page.off('request', trackGraph);
        });
        dataset.result = 'passed';
      } catch (error) {
        dataset.result = 'failed';
        dataset.error = error instanceof Error ? error.name : 'UnknownError';
        receipt.result = 'failed';
        throw error;
      } finally { await persist(); }
    });
  }

  test('rejects each independent graph capacity limit without partial data', { annotation: { type: 'scenario', description: 'capacity-limits' } }, async ({ page, request }, info) => {
    test.setTimeout(240_000);
    const assertRefusal = async (projectId: string, nodes: number, edges: number) => {
      const response = await request.get(`/api/v1/projects/${projectId}/task-graph`);
      expect(response.status()).toBe(409);
      const body = await response.json() as { error: { code: string; details: Omit<Limit, 'status'> } };
      expect(body.error.code).toBe('graph_limit_exceeded');
      const observed = { status: response.status(), ...body.error.details };
      expect(observed).toEqual({ status: 409, nodeCount: nodes, edgeCount: edges, maxNodes: 1000, maxEdges: 5000 });
      const browserResponse = page.waitForResponse((candidate) => candidate.url().endsWith(`/api/v1/projects/${projectId}/task-graph`));
      await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
      expect((await browserResponse).status()).toBe(409);
      await expect(page.getByRole('alert')).toContainText('任务图超过展示上限');
      await expect(page.getByRole('alert')).toContainText(`当前 ${nodes} 个任务、${edges} 条依赖`);
      await expect(page.getByRole('region', { name: '项目任务统计' })).toHaveCount(0);
      await expect(page.locator('.task-graph-canvas')).toHaveCount(0);
      await expect(page.locator('.root-list')).toHaveCount(0);
      await expect(page.locator('.standalone-list')).toHaveCount(0);
      await expect(page.getByRole('tablist', { name: '项目任务视图', exact: true })).toHaveCount(0);
      return observed;
    };
    try {
      await withScreenshot(page, info, 'capacity-limits', async () => {
        const nodeProject = await seedNodeLimit(request);
        receipt.limits.node = await assertRefusal(nodeProject.id, 1001, 0);
        await persist();
        const nodeScreenshot = join(evidenceDirectory(), 'capacity-limits-node.png');
        await page.screenshot({ path: nodeScreenshot, fullPage: false });
        await info.attach('capacity-limits-node', { path: nodeScreenshot, contentType: 'image/png' });

        if (mergeFixture === undefined || mergeFixture.additionalEdge === undefined) throw new Error('The measured merge fixture is required for the independent edge limit.');
        const { task, predecessorId } = mergeFixture.additionalEdge;
        const projectId = mergeFixture.project.id;
        expect(task.dependsOn).not.toContain(predecessorId);
        const extended = await updateTask(request, projectId, task.id, { version: task.version, dependsOn: [...task.dependsOn, predecessorId] });
        let original: unknown;
        try {
          receipt.limits.edge = await assertRefusal(projectId, 1000, 5001);
        } catch (error) {
          original = error;
          throw error;
        } finally {
          try {
            await updateTask(request, projectId, task.id, { version: extended.version, dependsOn: task.dependsOn });
            const restored = await request.get(`/api/v1/projects/${projectId}/task-graph`);
            expect(restored.status()).toBe(200);
            const body = await restored.json() as { tasks: { dependsOn: string[] }[] };
            expect(body.tasks.reduce((count, candidate) => count + candidate.dependsOn.length, 0)).toBe(5000);
          } catch (error) {
            if (original !== undefined) throw new AggregateError([original, error], 'Graph limit assertion and fixture restoration failed.');
            throw error;
          }
        }
      });
    } catch (error) {
      receipt.result = 'failed';
      throw error;
    } finally { await persist(); }
  });
});
