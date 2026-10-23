import type { Locator, Page } from '@playwright/test';
import { authenticatedAPI } from './authentication';
import { expect } from './fixtures';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const within = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 15_000);
    })]);
  } finally { clearTimeout(timer); }
};
const bounds = (elements: Locator) => elements.evaluateAll((nodes) => nodes.map((element) => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { className: element.className, x, y, width, height };
}));
type Geometry = Awaited<ReturnType<typeof bounds>>;
const expectSameBounds = (before: Geometry, actual: Geometry, phase: string): void => {
  expect(actual.map(({ className }) => className), `${phase}: same visible reading elements`).toEqual(before.map(({ className }) => className));
  for (const [index, original] of before.entries()) {
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(actual[index]![dimension] - original[dimension]), `${phase}: ${original.className} ${dimension}`).toBeLessThanOrEqual(1);
    }
  }
};

export const expectStableAutomaticDetailRefresh = async (
  page: Page,
  projectId: string,
  taskId: string,
  advance: () => Promise<void>,
  expectRetainedState: () => Promise<void>,
) => {
  const elements = page.locator('.task-detail-heading,.task-detail-title,.task-detail-tabs,.task-detail-panel:not([hidden])');
  const nodes = await elements.elementHandles();
  const before = await bounds(elements);
  expect(before).toHaveLength(4);
  const fetched = deferred();
  const release = deferred();
  const finished = deferred();
  const path = `/api/v1/projects/${projectId}/tasks/${taskId}`;
  const pattern = `**${path}`;
  let reads = 0;
  const handler: Parameters<Page['route']>[1] = async (route) => {
    reads++;
    try {
      const response = await authenticatedAPI(page.context().request).fetch(route.request(), { timeout: 15_000, maxRetries: 0 });
      expect(response.status()).toBe(200);
      fetched.resolve();
      await within(release.promise, 'unchanged automatic detail response release');
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
    } finally { finished.resolve(); }
  };
  await page.route(pattern, handler);
  try {
    await expectRetainedState();
    const response = page.waitForResponse((response) => new URL(response.url()).pathname === path);
    await advance();
    await within(fetched.promise, 'unchanged automatic detail GET');
    // Advance rendering frames while the real response stays gated; settled-only checks miss transient shifts.
    await page.clock.runFor(32);
    const during = await bounds(elements);
    expectSameBounds(before, during, 'pending detail response');
    await expectRetainedState();
    release.resolve();
    await within(finished.promise, 'unchanged automatic detail response completion');
    expect((await response).status()).toBe(200);
    expect(await (await response).finished()).toBeNull();
    await page.clock.runFor(32);
    const after = await bounds(elements);
    expectSameBounds(before, after, 'completed detail response');
    await expectRetainedState();
    for (const [index, node] of nodes.entries()) {
      expect(await node.evaluate((element, index) => element.isConnected && element === document.querySelectorAll('.task-detail-heading,.task-detail-title,.task-detail-tabs,.task-detail-panel:not([hidden])')[index], index)).toBe(true);
    }
    expect(reads, 'An unchanged graph receipt still reads the full task detail once').toBe(1);
    return { viewport: page.viewportSize(), before, during, after, reads };
  } finally {
    release.resolve();
    if (reads > 0) await within(finished.promise, 'automatic detail route cleanup');
    await page.unroute(pattern, handler);
    await Promise.all(nodes.map((node) => node.dispose()));
  }
};
