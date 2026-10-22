import { expect, type Locator, type Page } from '@playwright/test';

export const expectCenteredTaskDetail = async (page: Page, dialog: Locator): Promise<void> => {
  await expect.poll(async () => dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const gutter = window.innerWidth <= 600 ? 12 : 24;
    return Math.abs(bounds.x + bounds.width / 2 - window.innerWidth / 2) <= 0.5
      && Math.abs(bounds.y + bounds.height / 2 - window.innerHeight / 2) <= 0.5
      && bounds.width > 0 && bounds.width <= 960.5
      && bounds.x >= gutter - 0.5 && bounds.right <= window.innerWidth - gutter + 0.5
      && bounds.y >= gutter - 0.5 && bounds.bottom <= window.innerHeight - gutter + 0.5
      && bounds.height <= window.innerHeight - gutter * 2 + 0.5;
  }), { message: 'Task details remain centered within the available viewport and its required gutters' }).toBe(true);
  await expect(dialog.locator('.task-detail-header')).toBeInViewport({ ratio: 1 });
  const close = dialog.locator('.task-detail-close');
  await expect(close).toHaveRole('button');
  await expect(close).toBeEnabled();
  await expect(close).toHaveAccessibleName(/\S/);
  await expect(close).toBeInViewport({ ratio: 1 });
  await expect(dialog.locator('.task-detail-footer')).toBeInViewport({ ratio: 1 });
  expect(await dialog.locator('.task-detail-body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};

export const expectTaskDetailScroll = async (page: Page, dialog: Locator): Promise<void> => {
  const body = dialog.locator('.task-detail-panel-overview');
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const fixedBefore = await dialog.locator('.task-detail-header,.task-detail-footer').evaluateAll((elements) =>
    elements.map((element) => { const bounds = element.getBoundingClientRect(); return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; }));
  await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expectCenteredTaskDetail(page, dialog);
  expect(await dialog.locator('.task-detail-header,.task-detail-footer').evaluateAll((elements) =>
    elements.map((element) => { const bounds = element.getBoundingClientRect(); return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; }))).toEqual(fixedBefore);
  await body.evaluate((element) => { element.scrollTop = 0; });
};
