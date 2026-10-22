import { randomUUID } from 'node:crypto';
import type { Locator, Page, TestInfo } from '@playwright/test';
import {
  approveTask, createApprovedTask, createProject, createProposedTask, expect, seedTaskVersion, test,
  updateTask, withDependencyFailure,
} from './fixtures';
import { expectCenteredTaskDetail } from './detail-dialog';

const scenario = (description: string) => ({ annotation: { type: 'scenario', description } });
const standalone = (page: Page, id: string): Locator => page.locator(`#standalone-task-${id}`);
const node = (page: Page, id: string): Locator => page.locator(`.react-flow__node[data-id="${id}"] button.task-node`);
const detail = (page: Page): Locator => page.locator('.task-detail-dialog');
const approval = (page: Page): Locator => detail(page).locator('.task-approval');
const taskPath = (projectId: string, taskId: string): string => `/api/v1/projects/${projectId}/tasks/${taskId}`;
const graphPath = (projectId: string): string => `/api/v1/projects/${projectId}/task-graph`;
const origin = (info: TestInfo): string => {
  const value = info.project.use.baseURL;
  if (typeof value !== 'string') throw new Error('Approval acceptance requires the actual service base URL.');
  return new URL(value).origin;
};
const screenshot = async (page: Page, info: TestInfo, slug: string): Promise<void> => {
  const path = info.outputPath(`${slug}.png`);
  await page.screenshot({ path, fullPage: false, animations: 'disabled' });
  await info.attach('scenario-screenshot', { path, contentType: 'image/png' });
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const within = async (promise: Promise<unknown>, label: string): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 15_000);
    })]);
  } finally { clearTimeout(timer); }
};
const expectStatus = async (page: Page, value: '待审批' | '待处理' | 'Proposed' | 'To do'): Promise<void> => {
  await expect(detail(page).locator('.task-detail-status')).toHaveText(value);
};
const openStandalone = async (page: Page, id: string): Promise<void> => {
  await page.getByRole('tab', { name: '独立任务', exact: true }).click();
  await standalone(page, id).click();
  await expect(approval(page).getByRole('button', { name: '批准任务', exact: true })).toBeEnabled();
};

test('task-approval', scenario('task-approval'), async ({ page, request, allowApprovalWrites }, info) => {
  const project = await createProject(request, { name: `Approval ${randomUUID()}` });
  const exact = await createProposedTask(request, project.id, { title: '精确版本审批', description: '保留完整说明与任务内容。' });
  const other = await createApprovedTask(request, project.id, { title: '审批期间查看的另一任务' });
  const prerequisite = await createProposedTask(request, project.id, { title: '仍未完成的前置任务' });
  const blocked = await createProposedTask(request, project.id, { title: '有未完成前置的待审批任务', dependsOn: [prerequisite.id] });
  const exactVersion = 9223372036854775806n;
  await seedTaskVersion(project.id, exact.id, exactVersion);
  const exactResponse = await request.get(taskPath(project.id, exact.id));
  expect(await exactResponse.text()).toMatch(new RegExp(`"version"\\s*:\\s*${exactVersion}(?:,|})`));
  allowApprovalWrites([exact, blocked].map(({ id }) => ({ origin: origin(info), projectId: project.id, taskId: id, count: 1 })));
  await page.goto(`/projects/${project.id}`);
  await openStandalone(page, exact.id);
  await expectStatus(page, '待审批');
  await expect(detail(page).locator('.task-detail-description').first()).toHaveText(exact.description);
  const fetched = deferred();
  const release = deferred();
  const finished = deferred();
  const submitted: string[] = [];
  const pattern = `**${taskPath(project.id, exact.id)}/approve`;
  await page.route(pattern, async (route) => {
    submitted.push(route.request().postData()!);
    const response = await route.fetch({ timeout: 15_000, maxRetries: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toMatch(new RegExp(`"version"\\s*:\\s*${exactVersion + 1n}(?:,|})`));
    fetched.resolve();
    await within(release.promise, 'pending approval response release');
    await route.fulfill({ response });
    finished.resolve();
  });
  try {
    const button = approval(page).getByRole('button', { name: '批准任务', exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await within(fetched.promise, 'real exact-version approval commit');
    await expect(approval(page)).toHaveAttribute('aria-busy', 'true');
    await expect(approval(page).getByRole('button', { name: '正在批准…', exact: true })).toBeDisabled();
    await approval(page).getByRole('button').evaluate((element: HTMLButtonElement) => element.click());
    await page.keyboard.press('Escape');
    await expect(standalone(page, exact.id)).toBeFocused();
    await standalone(page, exact.id).click();
    await expect(approval(page)).toHaveAttribute('aria-busy', 'true');
    await expect(approval(page).getByRole('status')).toContainText('正在提交批准请求');
    await expect(approval(page).getByRole('button')).toBeDisabled();
    expect(submitted).toEqual([`{"version":${exactVersion}}`]);
    await page.keyboard.press('Escape');
    await standalone(page, other.id).click();
    await expect(detail(page).locator('.task-detail-title')).toHaveText(other.title);
    release.resolve();
    await within(finished.promise, 'delayed approval response');
    await expect(standalone(page, exact.id).locator('.root-status')).toHaveText('待处理');
    await expect(detail(page).locator('.task-detail-title')).toHaveText(other.title);
    await expectStatus(page, '待处理');
    await expect(approval(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await standalone(page, exact.id).click();
    await expectStatus(page, '待处理');
    await expect(approval(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
    expect(submitted).toEqual([`{"version":${exactVersion}}`]);
  } finally {
    release.resolve();
    await page.unroute(pattern);
  }
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '任务链', exact: true }).click();
  await expect(page.locator(`#task-root-${prerequisite.id}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#task-root-${prerequisite.id} .root-status`)).toHaveText('待审批');
  await page.getByRole('button', { name: '放大', exact: true }).click();
  const transform = await page.locator('.react-flow__viewport').getAttribute('style');
  const preferences = await page.evaluate((projectId) => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.endsWith(projectId) && !key.includes('scroll'))), project.id);
  await page.getByRole('button', { name: '全屏查看', exact: true }).click();
  const fullscreen = page.locator('.task-graph-fullscreen');
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', transform!);
  await node(page, blocked.id).click();
  await expectStatus(page, '待审批');
  await expect(approval(page)).toContainText('前置未完成时，任务仍会被阻塞');
  await expect(detail(page).getByRole('region', { name: '当前未完成的前置', exact: true })).toContainText(prerequisite.title);
  await page.setViewportSize({ width: 320, height: 740 });
  await detail(page).getByRole('combobox', { name: '语言 / Language', exact: true }).selectOption('en');
  await expectStatus(page, 'Proposed');
  await expectCenteredTaskDetail(page, detail(page));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const approve = approval(page).getByRole('button', { name: 'Approve task', exact: true });
  await approve.focus();
  const beforeApproval = await page.locator('.react-flow__viewport').getAttribute('style');
  const zoom = await page.locator('.react-flow__viewport').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
  const graphSubmitted = deferred();
  const graphRelease = deferred();
  const graphFinished = deferred();
  const graphApprovalPattern = `**${taskPath(project.id, blocked.id)}/approve`;
  await page.route(graphApprovalPattern, async (route) => {
    const response = await route.fetch({ timeout: 15_000, maxRetries: 0 });
    expect(response.status()).toBe(200);
    graphSubmitted.resolve();
    await within(graphRelease.promise, 'graph approval response release');
    await route.fulfill({ response });
    graphFinished.resolve();
  });
  try {
    await page.keyboard.press('Enter');
    await within(graphSubmitted.promise, 'real graph approval commit');
    const attachmentsTab = detail(page).getByRole('tab', { name: 'Attachments', exact: true });
    await attachmentsTab.click();
    await expect(attachmentsTab).toHaveAttribute('aria-selected', 'true');
    graphRelease.resolve();
    await within(graphFinished.promise, 'graph approval response');
    await expectStatus(page, 'To do');
    await expect(attachmentsTab).toHaveAttribute('aria-selected', 'true');
    await expect(attachmentsTab).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(detail(page).getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
  } finally {
    graphRelease.resolve();
    await page.unroute(graphApprovalPattern);
  }
  await expect(approval(page).getByRole('status')).toContainText('Approval confirmed');
  await expect(approval(page)).toContainText('Unfinished prerequisites still block it');
  await expect(detail(page).locator('.task-detail-blocked')).toHaveText('Blocked');
  await expect(approval(page).getByRole('button', { name: 'Approve task', exact: true })).toHaveCount(0);
  await expect(fullscreen).toBeVisible();
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', beforeApproval!);
  await screenshot(page, info, 'task-approval-narrow');
  await page.keyboard.press('Escape');
  await expect(node(page, blocked.id)).toBeFocused();
  await expect(node(page, blocked.id).locator('.graph-status')).toHaveText('To do');
  await expect(page.locator(`#task-root-${prerequisite.id} .root-status`)).toHaveText('To do');
  expect(await page.locator('.react-flow__viewport').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)).toBe(zoom);
  await page.keyboard.press('Escape');
  await expect(fullscreen).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View fullscreen', exact: true })).toBeFocused();
  expect(await page.evaluate((projectId) => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.endsWith(projectId) && !key.includes('scroll'))), project.id)).toEqual(preferences);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.getByRole('combobox', { name: '语言 / Language', exact: true }).selectOption('zh-CN');
  await expect(page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: /^待审批$/ }) }).locator('.stat-number')).toHaveText('1');
  await expect(page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: /^被阻塞$/ }) }).locator('.stat-number')).toHaveText('1');
  await screenshot(page, info, 'task-approval');
});

test('task-approval-conflicts', scenario('task-approval-conflicts'), async ({ page, request, allowApprovalWrites }, info) => {
  const project = await createProject(request, { name: `Approval conflict ${randomUUID()}` });
  const changed = await createProposedTask(request, project.id, { title: '批准前内容变化', description: '最初审阅的说明' });
  const external = await createProposedTask(request, project.id, { title: '已被其他调用方批准' });
  allowApprovalWrites([
    { origin: origin(info), projectId: project.id, taskId: changed.id, count: 2 },
    { origin: origin(info), projectId: project.id, taskId: external.id, count: 1 },
  ]);
  const posts: string[] = [];
  page.on('request', (value) => { if (value.method() === 'POST') posts.push(value.url()); });
  await page.goto(`/projects/${project.id}`);
  await openStandalone(page, changed.id);
  const updated = await updateTask(request, project.id, changed.id, { version: changed.version, description: '需要重新审阅的当前说明' });
  await approval(page).getByRole('button', { name: '批准任务', exact: true }).click();
  await expect(detail(page).locator('.task-detail-description').first()).toHaveText(updated.description);
  await expect(approval(page).getByRole('alert').first()).toContainText('任务已变化');
  await expect(approval(page)).toContainText('任务版本已变化');
  await expect(approval(page).getByRole('button', { name: '批准任务', exact: true })).toBeEnabled();
  expect(posts).toHaveLength(1);
  const current = await request.get(taskPath(project.id, changed.id));
  expect((await current.json() as { status: string }).status).toBe('proposed');
  await screenshot(page, info, 'task-approval-version-conflict');
  await approval(page).getByRole('button', { name: '批准任务', exact: true }).click();
  await expectStatus(page, '待处理');
  expect(posts).toHaveLength(2);
  await page.keyboard.press('Escape');
  await standalone(page, external.id).click();
  await expect(approval(page).getByRole('button', { name: '批准任务', exact: true })).toBeEnabled();
  await approveTask(request, project.id, external);
  await approval(page).getByRole('button', { name: '批准任务', exact: true }).click();
  await expectStatus(page, '待处理');
  await expect(approval(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
  expect(posts).toHaveLength(3);
  await screenshot(page, info, 'task-approval-conflicts');
});

test('task-approval-recovery', scenario('task-approval-recovery'), async ({ page, request, allowApprovalWrites }, info) => {
  const project = await createProject(request, { name: `Approval recovery ${randomUUID()}` });
  const unknown = await createProposedTask(request, project.id, { title: '响应丢失但已批准' });
  const graphFailure = await createProposedTask(request, project.id, { title: '保留已确认批准结果' });
  const stale = await createProposedTask(request, project.id, { title: '迟到的详情响应' });
  allowApprovalWrites([unknown, graphFailure].map(({ id }) => ({ origin: origin(info), projectId: project.id, taskId: id, count: 1 })));
  await page.goto(`/projects/${project.id}`);
  await openStandalone(page, unknown.id);
  let rejectReconciliation = true;
  const unknownReadPattern = `**${taskPath(project.id, unknown.id)}`;
  const unknownPostPattern = `${unknownReadPattern}/approve`;
  await page.route(unknownReadPattern, async (route) => {
    if (rejectReconciliation) await route.abort('connectionfailed');
    else await route.continue();
  });
  await page.route(unknownPostPattern, async (route) => {
    const response = await route.fetch({ timeout: 15_000, maxRetries: 0 });
    expect(response.status()).toBe(200);
    await route.abort('connectionfailed');
  });
  try {
    await approval(page).getByRole('button', { name: '批准任务', exact: true }).click();
    await expect(approval(page)).toContainText('批准结果尚未确认');
    await expect(approval(page)).toContainText('暂时无法确认当前任务状态');
    await expect(approval(page)).toContainText('批准请求未能从服务取得可确认的响应');
    await expect(approval(page).getByRole('button', { name: '批准任务', exact: true })).toBeDisabled();
    const persisted = await request.get(taskPath(project.id, unknown.id));
    expect((await persisted.json() as { status: string }).status).toBe('todo');
    await screenshot(page, info, 'task-approval-unknown');
    rejectReconciliation = false;
    await approval(page).getByRole('button', { name: '检查任务状态', exact: true }).click();
    await expectStatus(page, '待处理');
    await expect(approval(page)).toContainText('已确认当前任务状态');
    await expect(approval(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
  } finally {
    await page.unroute(unknownReadPattern);
    await page.unroute(unknownPostPattern);
  }
  await page.keyboard.press('Escape');
  await standalone(page, graphFailure.id).click();
  await expect(approval(page).getByRole('button', { name: '批准任务', exact: true })).toBeEnabled();
  let failGraph = true;
  const graphPattern = `**${graphPath(project.id)}`;
  await page.route(graphPattern, async (route) => {
    if (!failGraph) { await route.continue(); return; }
    const response = await withDependencyFailure(async () => route.fetch({ timeout: 15_000, maxRetries: 0 }));
    expect(response.status()).toBe(500);
    await route.fulfill({ response });
  });
  try {
    await approval(page).getByRole('button', { name: '批准任务', exact: true }).click();
    await expectStatus(page, '待处理');
    await expect(approval(page).getByRole('status')).toContainText('批准成功');
    await expect(detail(page).locator('.task-detail-stale')).toContainText('批准结果已保留');
    await expect(page.locator('.snapshot-error')).toBeVisible();
    await expect(approval(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
    await screenshot(page, info, 'task-approval-confirmed-graph-failure');
    failGraph = false;
    await detail(page).getByRole('button', { name: '刷新任务图', exact: true }).click();
    await expect(detail(page).locator('.task-detail-stale')).toHaveCount(0);
    await expectStatus(page, '待处理');
  } finally { await page.unroute(graphPattern); }
  await page.keyboard.press('Escape');
  const fetched = deferred();
  const release = deferred();
  const finished = deferred();
  const stalePattern = `**${taskPath(project.id, stale.id)}`;
  await page.route(stalePattern, async (route) => {
    const response = await route.fetch({ timeout: 15_000, maxRetries: 0 });
    expect(response.status()).toBe(200);
    fetched.resolve();
    await within(release.promise, 'stale task detail release');
    if (route.request().failure() !== null) await route.abort('aborted');
    else await route.fulfill({ response });
    finished.resolve();
  });
  try {
    await standalone(page, stale.id).click();
    await within(fetched.promise, 'real stale task detail fetch');
    await expect(detail(page).getByRole('status')).toContainText('正在加载任务详情');
    await page.keyboard.press('Escape');
    await standalone(page, graphFailure.id).click();
    await expect(detail(page).locator('.task-detail-title')).toHaveText(graphFailure.title);
    release.resolve();
    await within(finished.promise, 'stale task response disposal');
    await expect(detail(page).locator('.task-detail-title')).toHaveText(graphFailure.title);
    await expectStatus(page, '待处理');
    await expect(approval(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
    await screenshot(page, info, 'task-approval-recovery');
  } finally {
    release.resolve();
    await page.unroute(stalePattern);
  }
});
