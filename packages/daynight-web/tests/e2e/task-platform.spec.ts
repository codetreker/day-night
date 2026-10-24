import type { Locator, Page } from '@playwright/test';
import { approveTask, claimTask, createProject, createProposedTask, expect, test, updateTask, type Task } from './fixtures';
import { expectCenteredTaskDetail } from './detail-dialog';

const scenario = { annotation: { type: 'scenario', description: 'task-platform' } };
const taskPath = (project: string, task: string): string => `/api/v1/projects/${project}/tasks/${task}`;
const detail = (page: Page): Locator => page.locator('.task-detail-dialog');
const platform = (page: Page): Locator => detail(page).getByRole('combobox', { name: /^(执行平台|Execution platform)$/, exact: true });
const save = (page: Page): Locator => detail(page).getByRole('button', { name: /^(保存平台|Save platform)$/, exact: true });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
const open = async (page: Page, id: string): Promise<void> => {
  await page.getByRole('tab', { name: /^(独立任务|Standalone tasks)$/, exact: true }).click();
  await page.locator(`#standalone-task-${id}`).click();
  await expect(platform(page)).toBeVisible();
};
const geometry = async (page: Page): Promise<void> => {
  await expectCenteredTaskDetail(page, detail(page));
  expect(await detail(page).locator('.task-detail-status-row').evaluate((row) => {
    const bounds = row.getBoundingClientRect();
    const left = row.querySelector('.task-detail-badges')!.getBoundingClientRect();
    const right = row.querySelector('.task-automation-control')!.getBoundingClientRect();
    return Math.abs(bounds.right - right.right) < .5 && Math.abs(left.y - right.y) < .5 && left.right <= right.left && row.scrollWidth <= row.clientWidth;
  })).toBe(true);
  expect(await detail(page).evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
};

test('task-platform', scenario, async ({ page, api, allowBrowserWrites }, info) => {
  const own = await createProject(api, { name: 'Execution platform acceptance' });
  let task = await createProposedTask(api, own.id, { title: '执行平台：原生环境要求', description: '平台、自动执行与审批分别保有原义。' });
  const other = await createProposedTask(api, own.id, { title: '另一个任务', requiredPlatform: 'windows' });
  expect(task.requiredPlatform).toBeNull(); expect(other.requiredPlatform).toBe('windows');
  const base = info.project.use.baseURL;
  if (typeof base !== 'string') throw new Error('Platform acceptance requires the actual service origin.');
  const endpoint = new URL(taskPath(own.id, task.id), base).href;
  allowBrowserWrites([{ method: 'PATCH', url: endpoint, count: 6 }]);
  const writes: { version: string; requiredPlatform: Task['requiredPlatform']; result: number }[] = [];
  let mode: 'ordinary' | 'conflict' | 'unknown' | 'pending' = 'ordinary';
  let rejectReconciliation = false;
  const pendingReached = deferred(); const releasePending = deferred();
  await page.route(endpoint, async (route) => {
    if (route.request().method() === 'GET') {
      if (rejectReconciliation) await route.abort('connectionfailed'); else await route.continue();
      return;
    }
    if (route.request().method() !== 'PATCH') { await route.continue(); return; }
    const raw = route.request().postData();
    if (raw === null) throw new Error('Platform PATCH requires an exact body.');
    const data = JSON.parse(raw) as { version: number; requiredPlatform: Task['requiredPlatform'] };
    expect(Object.keys(data).sort()).toEqual(['requiredPlatform', 'version']);
    if (mode === 'conflict') {
      const current = await (await api.get(taskPath(own.id, task.id))).json() as Task;
      task = await updateTask(api, own.id, task.id, { version: current.version, description: '平台保存之前，任务版本已变化。' });
      mode = 'ordinary';
    }
    const response = await route.fetch();
    writes.push({ version: String(data.version), requiredPlatform: data.requiredPlatform, result: response.status() });
    if (mode === 'unknown') { rejectReconciliation = true; mode = 'ordinary'; await route.abort('connectionfailed'); return; }
    if (mode === 'pending') { mode = 'ordinary'; pendingReached.resolve(); await releasePending.promise; }
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/projects/${own.id}`); await open(page, task.id); await geometry(page);
    await expect(platform(page)).toHaveValue(''); await expect(save(page)).toBeDisabled();
    await platform(page).selectOption('linux'); expect(writes).toHaveLength(0);
    expect((await (await api.get(taskPath(own.id, task.id))).json() as Task).requiredPlatform).toBeNull();
    await save(page).click(); await expect(detail(page).locator('.task-detail-badges .task-platform')).toHaveText('Linux');
    expect((await (await api.get(taskPath(own.id, task.id))).json() as Task)).toMatchObject({ requiredPlatform: 'linux', allowAgents: false, status: 'proposed', ready: false });
    await platform(page).selectOption(''); await save(page).click(); await expect(detail(page).locator('.task-detail-badges .task-platform')).toHaveText('不限平台');

    mode = 'conflict'; await platform(page).selectOption('windows'); await save(page).click();
    await expect(detail(page).getByText('任务已发生变化，请检查当前平台后重新保存修改。')).toBeVisible();
    await expect(platform(page)).toHaveValue(''); await expect(save(page)).toBeDisabled(); expect(writes).toHaveLength(3);
    await platform(page).selectOption('windows'); await save(page).click(); await expect(detail(page).locator('.task-detail-badges .task-platform')).toHaveText('Windows');

    mode = 'unknown'; await platform(page).selectOption('linux'); await save(page).click();
    const check = detail(page).getByRole('button', { name: '核对实际任务', exact: true }); await expect(check).toBeEnabled();
    await expect(platform(page)).toBeDisabled(); await expect(detail(page).getByRole('switch')).toBeDisabled();
    await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toBeDisabled();
    await expect(detail(page).locator('.task-detail-badges .task-platform')).toHaveText('Windows');
    rejectReconciliation = false; await check.click(); await expect(platform(page)).toHaveValue('linux'); await expect(platform(page)).toBeEnabled(); expect(writes).toHaveLength(5);

    mode = 'pending'; await platform(page).selectOption('macos'); await save(page).click(); await pendingReached.promise;
    await expect(platform(page)).toBeDisabled(); await expect(detail(page).getByRole('switch')).toBeDisabled();
    await detail(page).getByRole('button', { name: '关闭任务详情', exact: true }).click();
    await open(page, other.id); await expect(platform(page)).toHaveValue('windows'); releasePending.resolve();
    await expect.poll(async () => (await (await api.get(taskPath(own.id, task.id))).json() as Task).requiredPlatform).toBe('macos');
    await expect(platform(page)).toHaveValue('windows'); await detail(page).getByRole('button', { name: '关闭任务详情', exact: true }).click();
    await expect(page.locator(`#standalone-task-${task.id} .task-platform`)).toHaveText('macOS');
    await open(page, task.id); await expect(platform(page)).toHaveValue('macos'); await expect(platform(page)).toBeEnabled();
    expect(writes.map((entry) => entry.result)).toEqual([200, 200, 409, 200, 200, 200]);

    task = await (await api.get(taskPath(own.id, task.id))).json() as Task;
    const claimed = await claimTask(api, own.id, await approveTask(api, own.id, task)); expect(claimed.requiredPlatform).toBe('macos');
    await detail(page).getByRole('button', { name: '关闭任务详情', exact: true }).click(); await page.reload(); await open(page, task.id);
    await expect(platform(page)).toBeDisabled(); await expect(save(page)).toBeDisabled();
    await expect(detail(page).getByText('任务已被领取，执行结束或解除领取前无法修改执行平台。')).toBeVisible();
    for (const { locale, width } of [{ locale: 'zh-CN', width: 390 }, { locale: 'en', width: 390 }, { locale: 'zh-CN', width: 320 }, { locale: 'en', width: 320 }]) {
      await detail(page).getByRole('button', { name: /^(关闭任务详情|Close task details)$/, exact: true }).click();
      await page.getByRole('combobox', { name: '语言 / Language', exact: true }).selectOption(locale);
      await page.setViewportSize({ width, height: 844 }); await open(page, task.id); await geometry(page);
      const screenshot = info.outputPath(`task-platform-${locale}-${width}.png`); await page.screenshot({ path: screenshot, animations: 'disabled' });
      await info.attach('scenario-screenshot', { path: screenshot, contentType: 'image/png' });
    }
    await info.attach('platform-write-receipts', { body: JSON.stringify({ writes, final: { id: claimed.id, status: claimed.status, requiredPlatform: claimed.requiredPlatform } }, null, 2), contentType: 'application/json' });
  } finally { releasePending.resolve(); await page.unroute(endpoint); }
});
