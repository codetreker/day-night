import { randomUUID } from 'node:crypto';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { attachmentDownloadUrl } from '../../src/api/client';
import {
  approveTask, createProject, createProposedTask, expect, seedTaskVersion, test,
  updateTask, withDependencyFailure,
} from './fixtures';
import { expectCenteredTaskDetail } from './detail-dialog';

const scenario = (description: string) => ({ annotation: { type: 'scenario', description } });
const standalone = (page: Page, id: string): Locator => page.locator(`#standalone-task-${id}`);
const node = (page: Page, id: string): Locator => page.locator(`.react-flow__node[data-id="${id}"] button.task-node-body`);
const details = (page: Page, id: string): Locator => page.locator(`.react-flow__node[data-id="${id}"] button.task-node-details`);
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
const within = async (promise: Promise<unknown>, label: string, timeoutMs = 15_000): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
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
const pauseAutomaticRefresh = async (page: Page): Promise<void> => {
  const time = new Date('2030-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
};

test('task-approval', scenario('task-approval'), async ({ page, request, allowApprovalWrites, allowAttachmentWrites }, info) => {
  await pauseAutomaticRefresh(page);
  const project = await createProject(request, { name: `Approval ${randomUUID()}` });
  const exact = await createProposedTask(request, project.id, { title: '精确版本审批', description: '保留完整说明与任务内容。' });
  const other = await createProposedTask(request, project.id, { title: '审批期间查看的另一任务', description: '刷新前审阅的完整详情' });
  const prerequisite = await createProposedTask(request, project.id, { title: '仍未完成的前置任务' });
  const blocked = await createProposedTask(request, project.id, { title: '有未完成前置的待审批任务', dependsOn: [prerequisite.id] });
  for (let index = 0; index < 79; index++) {
    await createProposedTask(request, project.id, { title: `审批图后续 ${index}`, dependsOn: [prerequisite.id] });
  }
  const exactVersion = 9223372036854775806n;
  await seedTaskVersion(project.id, exact.id, exactVersion);
  const exactResponse = await request.get(taskPath(project.id, exact.id));
  expect(await exactResponse.text()).toMatch(new RegExp(`"version"\\s*:\\s*${exactVersion}(?:,|})`));
  allowApprovalWrites([exact, blocked].map(({ id }) => ({ origin: origin(info), projectId: project.id, taskId: id, count: 1 })));
  const previewPath = 'preview.txt';
  const previewText = 'Attachment preview retained through another task approval.\n';
  const seededPreview = await request.put(attachmentDownloadUrl(project.id, other.id, previewPath), {
    headers: { 'content-type': 'text/plain' }, data: previewText,
  });
  expect(seededPreview.status()).toBe(201);
  const uploadPath = 'uploads/preserved.txt';
  const uploadBytes = Buffer.from('Original upload bytes survive a fresh task detail read.\n');
  const uploadUrl = new URL(attachmentDownloadUrl(project.id, other.id, uploadPath), origin(info)).href;
  allowAttachmentWrites([{ origin: origin(info), method: 'PUT', projectId: project.id, taskId: other.id, path: uploadPath, count: 1 }]);
  await page.addInitScript(({ url }) => {
    const originalFetch = window.fetch;
    const probe: { body: File | null; signal: AbortSignal | null; requests: number } = { body: null, signal: null, requests: 0 };
    Reflect.set(window, 'approvalUploadProbe', probe);
    window.fetch = (input, init) => {
      const requestedUrl = input instanceof Request ? input.url : new URL(String(input), location.href).href;
      if (requestedUrl === url && init?.method === 'PUT') {
        if (!(init.body instanceof File) || !(init.signal instanceof AbortSignal)) throw new Error('The upload must retain its original File and AbortSignal.');
        probe.body = init.body;
        probe.signal = init.signal;
        probe.requests++;
      }
      return originalFetch(input, init);
    };
  }, { url: uploadUrl });
  await page.goto(`/projects/${project.id}`);
  await openStandalone(page, exact.id);
  await expectStatus(page, '待审批');
  await expect(detail(page).locator('.task-description')).toHaveText(exact.description);
  const fetched = deferred();
  const release = deferred();
  const finished = deferred();
  const uploadFetched = deferred();
  const uploadRelease = deferred();
  const uploadFinished = deferred();
  const otherFetched = deferred();
  const otherRelease = deferred();
  const otherFinished = deferred();
  let holdOtherRead = false;
  let otherTitle = other.title;
  const otherPattern = `**${taskPath(project.id, other.id)}`;
  const uploadFailures: string[] = [];
  page.on('requestfailed', (failed) => { if (failed.url() === uploadUrl) uploadFailures.push(failed.failure()!.errorText); });
  await page.route(uploadUrl, async (route) => {
    if (route.request().method() !== 'PUT') { await route.fallback(); return; }
    expect(route.request().postDataBuffer()).toEqual(uploadBytes);
    const response = await route.fetch({ timeout: 15_000, maxRetries: 0 });
    expect(response.status()).toBe(201);
    uploadFetched.resolve();
    await within(uploadRelease.promise, 'active attachment upload response release', 60_000);
    await route.fulfill({ response });
    uploadFinished.resolve();
  });
  await page.route(otherPattern, async (route) => {
    if (!holdOtherRead) { await route.continue(); return; }
    const response = await route.fetch({ timeout: 15_000, maxRetries: 0 });
    expect(response.status()).toBe(200);
    expect((await response.json() as { title: string }).title).toBe(otherTitle);
    otherFetched.resolve();
    await within(otherRelease.promise, 'background task detail response release', 60_000);
    await route.fulfill({ response });
    otherFinished.resolve();
  });
  const submitted: string[] = [];
  const pattern = `**${taskPath(project.id, exact.id)}/approve`;
  await page.route(pattern, async (route) => {
    submitted.push(route.request().postData()!);
    const response = await route.fetch({ timeout: 15_000, maxRetries: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toMatch(new RegExp(`"version"\\s*:\\s*${exactVersion + 1n}(?:,|})`));
    fetched.resolve();
    await within(release.promise, 'pending approval response release', 60_000);
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
    const attachmentsTab = detail(page).getByRole('tab', { name: '附件', exact: true });
    await attachmentsTab.click();
    const attachments = detail(page).locator('.task-attachments');
    await attachments.locator('.attachment-file').filter({ hasText: previewPath }).click();
    await expect(attachments.locator('pre')).toHaveText(previewText);
    const fileInput = attachments.locator('input[type=file]');
    const pathInput = attachments.locator('input[type=text]');
    const uploadDisclosure = attachments.locator('.attachment-upload-disclosure');
    await expect(uploadDisclosure).not.toHaveAttribute('open', '');
    await expect(pathInput).toBeHidden();
    await uploadDisclosure.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(uploadDisclosure).toHaveAttribute('open', '');
    await expect(fileInput).toBeVisible();
    await expect(pathInput).toBeVisible();
    await fileInput.setInputFiles({ name: 'original.txt', mimeType: 'text/plain', buffer: uploadBytes });
    await pathInput.fill(uploadPath);
    const disclosureElement = await uploadDisclosure.elementHandle();
    const inputElement = await fileInput.elementHandle();
    const previewElement = await attachments.locator('.attachment-preview').elementHandle();
    const textElement = await attachments.locator('pre').elementHandle();
    if (disclosureElement === null || inputElement === null || previewElement === null || textElement === null) throw new Error('The active attachment workspace is absent.');
    await attachments.getByRole('button', { name: '上传文件', exact: true }).click();
    await within(uploadFetched.promise, 'real attachment upload commit');
    await attachmentsTab.focus();
    const assertUploadRetained = async (): Promise<void> => {
      await expect(attachmentsTab).toHaveAttribute('aria-selected', 'true');
      await expect(attachmentsTab).toBeFocused();
      await expect(uploadDisclosure).toHaveAttribute('open', '');
      await expect(fileInput).toBeDisabled();
      await expect(pathInput).toHaveValue(uploadPath);
      await expect(pathInput).toBeDisabled();
      await expect(attachments.getByRole('button', { name: '正在上传…', exact: true })).toBeDisabled();
      await expect(attachments.locator('.attachment-file-selected')).toContainText(previewPath);
      await expect(attachments.locator('pre')).toHaveText(previewText);
      expect(await disclosureElement.evaluate((element) => element.isConnected && element === document.querySelector('.task-attachments .attachment-upload-disclosure'))).toBe(true);
      expect(await inputElement.evaluate((element) => element.isConnected && element === document.querySelector('.task-attachments input[type=file]'))).toBe(true);
      expect(await previewElement.evaluate((element) => element.isConnected && element === document.querySelector('.task-attachments .attachment-preview'))).toBe(true);
      expect(await textElement.evaluate((element) => element.isConnected && element === document.querySelector('.task-attachments pre'))).toBe(true);
      const pending = await page.evaluate(async () => {
        const probe = Reflect.get(window, 'approvalUploadProbe') as { body: File; signal: AbortSignal; requests: number };
        const selected = document.querySelector<HTMLInputElement>('.task-attachments input[type=file]')!.files![0];
        return { requests: probe.requests, aborted: probe.signal.aborted, sameFile: selected === probe.body,
          name: selected!.name, bytes: [...new Uint8Array(await probe.body.arrayBuffer())] };
      });
      expect(pending).toEqual({ requests: 1, aborted: false, sameFile: true, name: 'original.txt', bytes: [...uploadBytes] });
      expect(uploadFailures).toEqual([]);
    };
    await assertUploadRetained();
    const updatedOther = await updateTask(request, project.id, other.id, { version: other.version, title: '任务图已更新、附件工作区持续保留', description: '后台读取返回的新详情' });
    otherTitle = updatedOther.title;
    holdOtherRead = true;
    const refreshedGraph = page.waitForResponse((response) => new URL(response.url()).pathname === graphPath(project.id));
    release.resolve();
    await within(finished.promise, 'delayed approval response');
    expect((await refreshedGraph).status()).toBe(200);
    await within(otherFetched.promise, 'fresh task detail after another approval');
    await expect(standalone(page, exact.id).locator('.root-status')).toHaveText('待处理');
    await expect(standalone(page, other.id).locator('.root-title')).toHaveText(updatedOther.title);
    await expect(detail(page).locator('.task-detail-title')).toHaveText(other.title);
    await expectStatus(page, '待审批');
    await expect(approval(page).getByRole('button', { name: '批准任务', exact: true, includeHidden: true })).toBeDisabled();
    await assertUploadRetained();
    otherRelease.resolve();
    await within(otherFinished.promise, 'fresh background task detail response');
    await expect(detail(page).locator('.task-detail-title')).toHaveText(updatedOther.title);
    await expect(approval(page).getByRole('button', { name: '批准任务', exact: true, includeHidden: true })).toBeEnabled();
    await assertUploadRetained();
    await screenshot(page, info, 'task-approval-preserves-active-upload');
    uploadRelease.resolve();
    await within(uploadFinished.promise, 'original attachment upload response');
    await expect(pathInput).toHaveValue('');
    await expect(fileInput).toBeEnabled();
    expect(await fileInput.evaluate((element: HTMLInputElement) => element.files!.length)).toBe(0);
    await expect(attachments.getByRole('heading', { name: uploadPath, exact: true })).toBeVisible();
    await expect(attachments.locator('pre')).toHaveText(uploadBytes.toString('utf8'));
    await expect(uploadDisclosure).toHaveAttribute('open', '');
    expect(await disclosureElement.evaluate((element) => element.isConnected && element === document.querySelector('.task-attachments .attachment-upload-disclosure'))).toBe(true);
    const storedUpload = await request.get(attachmentDownloadUrl(project.id, other.id, uploadPath));
    expect(await storedUpload.body()).toEqual(uploadBytes);
    expect(uploadFailures).toEqual([]);
    await disclosureElement.dispose();
    await inputElement.dispose();
    await previewElement.dispose();
    await textElement.dispose();
    await page.keyboard.press('Escape');
    await standalone(page, exact.id).click();
    await expectStatus(page, '待处理');
    await expect(approval(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
    expect(submitted).toEqual([`{"version":${exactVersion}}`]);
  } finally {
    release.resolve();
    otherRelease.resolve();
    uploadRelease.resolve();
    await page.unroute(pattern);
    await page.unroute(otherPattern);
    await page.unroute(uploadUrl);
  }
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '任务链', exact: true }).click();
  await page.clock.runFor(100);
  await expect(page.locator(`#task-root-${prerequisite.id}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#task-root-${prerequisite.id} .root-status`)).toHaveText('待审批');
  await expect(page.locator('.task-graph')).toHaveAttribute('data-visible-task-count', '50');
  await expect(page.locator('.task-graph')).toHaveAttribute('data-total-task-count', '81');
  await page.locator(`.react-flow__node[data-id="${prerequisite.id}"] .task-node-expand[data-direction="successors"]`).click();
  await page.clock.runFor(100);
  await expect(page.locator('.task-graph')).toHaveAttribute('data-visible-task-count', '70');
  const visibleGraph = () => page.evaluate(() => ({
    nodes: [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((element) => element.dataset.id!).sort(),
    edges: [...document.querySelectorAll<SVGGElement>('.task-dependency-edge')].map((element) => element.dataset.id!).sort(),
  }));
  const expandedGraph = await visibleGraph();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.clock.runFor(500);
  const transform = await page.locator('.react-flow__viewport').getAttribute('style');
  const preferences = await page.evaluate((projectId) => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.endsWith(projectId) && !key.includes('scroll'))), project.id);
  await page.getByRole('button', { name: '全屏查看', exact: true }).click();
  const fullscreen = page.locator('.task-graph-fullscreen');
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', transform!);
  await details(page, blocked.id).focus();
  await page.keyboard.press('Enter');
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
  expect(await visibleGraph()).toEqual(expandedGraph);
  await expect(page.locator('.task-graph')).toHaveAttribute('data-visible-task-count', '70');
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', beforeApproval!);
  await screenshot(page, info, 'task-approval-narrow');
  await page.keyboard.press('Escape');
  await expect(details(page, blocked.id)).toBeFocused();
  await expect(node(page, blocked.id).locator('.graph-status')).toHaveText('To do');
  await expect(page.locator(`#task-root-${prerequisite.id} .root-status`)).toHaveText('To do');
  expect(await page.locator('.react-flow__viewport').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)).toBe(zoom);
  await page.keyboard.press('Escape');
  await expect(fullscreen).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View fullscreen', exact: true })).toBeFocused();
  expect(await page.evaluate((projectId) => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.endsWith(projectId) && !key.includes('scroll'))), project.id)).toEqual(preferences);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.getByRole('combobox', { name: '语言 / Language', exact: true }).selectOption('zh-CN');
  await expect(page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: /^待审批$/ }) }).locator('.stat-number')).toHaveText('81');
  await expect(page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: /^被阻塞$/ }) }).locator('.stat-number')).toHaveText('1');
  await screenshot(page, info, 'task-approval');
});

test('task-approval-conflicts', scenario('task-approval-conflicts'), async ({ page, request, allowApprovalWrites }, info) => {
  await pauseAutomaticRefresh(page);
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
  await expect(detail(page).locator('.task-description')).toHaveText(updated.description);
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
  await pauseAutomaticRefresh(page);
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
