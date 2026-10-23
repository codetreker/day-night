import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { APIResponse, Locator, Page, Route, TestInfo } from '@playwright/test';
import { createAcceptanceCli } from '../../scripts/acceptance/installed-cli.mts';
import { parseApiJson } from '../../src/api/json';
import { parseTaskDetail, parseTaskGraph } from '../../src/api/parse';
import type { TaskDetail } from '../../src/api/types';
import { attachmentDownloadUrl } from '../../src/api/client';
import {
  createProject, createProposedTask, expect, seedTaskVersion, test,
  updateTask, withDependencyFailure,
} from './fixtures';
import { expectCenteredTaskDetail } from './detail-dialog';
import { authenticatedAPI } from './authentication';

const scenario = (description: string) => ({ annotation: { type: 'scenario', description } });
const standalone = (page: Page, id: string): Locator => page.locator(`#standalone-task-${id}`);
const node = (page: Page, id: string): Locator => page.locator(`.react-flow__node[data-id="${id}"] button.task-node-body`);
const details = (page: Page, id: string): Locator => page.locator(`.react-flow__node[data-id="${id}"] button.task-node-details`);
const detail = (page: Page): Locator => page.locator('.task-detail-dialog');
const approval = (page: Page): Locator => detail(page).locator('.task-approval');
const confirmation = (page: Page, action: 'approve' | 'unapprove' = 'approve', language: 'zh-CN' | 'en' = 'zh-CN'): Locator =>
  page.getByRole('alertdialog', { name: language === 'en' ? action === 'approve' ? 'Approve task' : 'Unapprove task' : action === 'approve' ? '批准任务' : '撤回审批', exact: true });
const confirmAction = async (page: Page, action: 'approve' | 'unapprove' = 'approve', language: 'zh-CN' | 'en' = 'zh-CN'): Promise<void> => {
  const dialog = confirmation(page, action, language);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: language === 'en' ? action === 'approve' ? 'Confirm approval' : 'Confirm withdrawal' : action === 'approve' ? '确认批准' : '确认撤回', exact: true }).click();
};
const submitApproval = async (page: Page, language: 'zh-CN' | 'en' = 'zh-CN'): Promise<void> => {
  await detail(page).getByRole('button', { name: language === 'en' ? 'Approve task' : '批准任务', exact: true }).click();
  await confirmAction(page, 'approve', language);
};
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
  await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toBeEnabled();
};
const pauseAutomaticRefresh = async (page: Page): Promise<void> => {
  const time = new Date('2030-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
};

type LifecycleCommand = {
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stdoutSha256?: string;
  readonly stderr: string;
  readonly requestIds: readonly string[];
};
type LifecycleWebWrite = {
  readonly action: 'approve' | 'unapprove';
  readonly taskId: string;
  readonly expectedBody: string;
  readonly status: number;
  readonly responseBody: string;
  readonly requestId: string | null;
};
const resourceId = (output: string): string => {
  const matches = [...output.matchAll(/^ID: ([0-9a-f-]{36})$/gm)];
  expect(matches, 'A successful installed mutation identifies exactly one resource').toHaveLength(1);
  return matches[0]![1]!;
};
const lifecycleActor = async (page: Page, info: TestInfo, name: string) => {
  const receiptPath = process.env.DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT;
  if (receiptPath === undefined) throw new Error('Lifecycle evidence requires the validated installed CLI receipt.');
  const installedCli: unknown = JSON.parse(await readFile(receiptPath, 'utf8'));
  const cli = await createAcceptanceCli(origin(info), info.outputPath(`installed-cli-${name}`));
  const evidence = {
    scenario: name, topology: process.env.DAYNIGHT_ACCEPTANCE_TARGET, serviceOrigin: origin(info), installedCli,
    commands: [] as LifecycleCommand[], webWrites: [] as LifecycleWebWrite[],
    snapshots: [] as { label: string; task: TaskDetail }[],
    rawReads: [] as { label: string; path: string; body: string }[],
    attachmentSnapshots: [] as { label: string; bytes: number; sha256: string }[],
    controlledFaults: [] as string[],
  };
  const run = async (argv: readonly string[]) => {
    const result = await cli.run(argv);
    evidence.commands.push({ argv, ...result, requestIds: [...result.stderr.matchAll(/requestId=([A-Za-z0-9_.:-]+)/g)].map((match) => match[1]!) });
    return result;
  };
  const success = async (argv: readonly string[]): Promise<string> => {
    const result = await run(argv);
    expect(result.exitCode, `Installed CLI succeeds: ${argv.join(' ')}`).toBe(0);
    expect(result.stderr).toBe('');
    return result.stdout;
  };
  const show = async (projectId: string, taskId: string, label: string): Promise<TaskDetail> => {
    const task = parseTaskDetail(parseApiJson(await success(['task', 'show', taskId, '--project', projectId, '--json'])), projectId, taskId);
    evidence.snapshots.push({ label, task });
    return task;
  };
  const bytes = async (projectId: string, taskId: string, path: string, label: string): Promise<Buffer> => {
    const argv = ['task', 'attachment', 'read', taskId, path, '--project', projectId];
    const content = await cli.read(argv);
    const sha256 = createHash('sha256').update(content).digest('hex');
    evidence.commands.push({ argv, exitCode: 0, stdoutSha256: sha256, stderr: '', requestIds: [] });
    evidence.attachmentSnapshots.push({ label, bytes: content.length, sha256 });
    return content;
  };
  const capture = async (route: Route, taskId: string): Promise<APIResponse> => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1);
    if (action !== 'approve' && action !== 'unapprove') throw new Error('Approval evidence requires a named approval operation.');
    const response = await authenticatedAPI(page.context().request).fetch(route.request(), { timeout: 15_000, maxRetries: 0 });
    const responseBody = await response.text();
    const error = response.status() === 409 ? JSON.parse(responseBody) as { error: { code: string; requestId: string } } : null;
    evidence.webWrites.push({ action, taskId, expectedBody: route.request().postData()!, status: response.status(), responseBody,
      requestId: error === null ? response.headers()['x-request-id'] ?? null : error.error.requestId });
    return response;
  };
  const attach = async (): Promise<void> => {
    await info.attach(`${name}-lifecycle`, { contentType: 'application/json',
      body: Buffer.from(JSON.stringify(evidence, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value, 2)) });
  };
  return { run, success, show, bytes, capture, attach, evidence, close: cli.close };
};
const invariantFields = (task: TaskDetail) => ({
  id: task.id, projectId: task.projectId, title: task.title, description: task.description,
  properties: task.properties, dependsOn: task.dependsOn, createdAt: task.createdAt,
});
const approvalInvariantFields = (task: TaskDetail) => ({ ...invariantFields(task), startedAt: task.startedAt, completedAt: task.completedAt });
const expectTitleAction = async (page: Page, label: string): Promise<Locator> => {
  const row = detail(page).locator('.task-detail-title-row');
  const button = row.getByRole('button', { name: label, exact: true });
  await expect(button).toBeEnabled();
  await expect.poll(() => row.evaluate((element) => {
    const title = element.querySelector('.task-detail-title')!.getBoundingClientRect();
    const action = element.querySelector('.task-detail-title-action')!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return action.x >= title.right && Math.abs(action.right - bounds.right) <= 1
      && action.width > 0 && action.height > 0 && element.scrollWidth <= element.clientWidth;
  }), { message: 'The approval entry occupies the title row far right without overlapping the title' }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  return button;
};
const navigateProject = async (page: Page, projectId: string): Promise<void> => {
  await page.getByRole('link', { name: '← 项目', exact: true }).click();
  await expect(page.getByRole('list', { name: '项目列表', exact: true })).toBeVisible();
  const card = page.locator(`.project-card[href="/projects/${projectId}"]`);
  while (await card.count() === 0) {
    const before = await page.locator('.project-card').count();
    await page.getByRole('button', { name: '加载更多', exact: true }).click();
    await expect.poll(() => page.locator('.project-card').count()).toBeGreaterThan(before);
  }
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
};

test('task-approval', scenario('task-approval'), async ({ page, api: request, allowApprovalWrites, allowAttachmentWrites }, info) => {
  await pauseAutomaticRefresh(page);
  const lifecycle = await lifecycleActor(page, info, 'task-approval');
  try {
    const sharedProjectId = resourceId(await lifecycle.success(['project', 'create', `Installed lifecycle ${randomUUID()}`, '--repo', `https://example.com/lifecycle/${randomUUID()}`]));
    const prerequisiteDescription = '# Prerequisite\n\nGoal: finish the dependency before starting the dependent task.\n\nAcceptance: approved, claimed and completed through the installed CLI.';
    const sharedDescription = '# Lifecycle delivery\n\nGoal: verify the same task through the installed CLI, production Web and PostgreSQL.\n\nAcceptance: blocked approval, refused premature claim, completed prerequisite and named claim/complete.\n\nMaterials: [Plan](plan.md) and binary evidence payload.bin.';
    const sharedPrerequisiteId = resourceId(await lifecycle.success(['task', 'create', '--project', sharedProjectId, '--title', 'CLI prerequisite 中文', '--description', prerequisiteDescription]));
    const sharedDependentId = resourceId(await lifecycle.success(['task', 'create', '--project', sharedProjectId, '--title', 'CLI dependent 中文', '--description', sharedDescription,
      '--depends-on', sharedPrerequisiteId, '--pull-request-url', 'https://example.com/pull/17', '--pull-request-title', 'Preserved lifecycle reference']));
    const sharedPrerequisite = await lifecycle.show(sharedProjectId, sharedPrerequisiteId, 'prerequisite-created-proposed');
    const sharedDependent = await lifecycle.show(sharedProjectId, sharedDependentId, 'dependent-created-proposed');
    expect(sharedPrerequisite).toMatchObject({ status: 'proposed', version: 1n, ready: false, blockedBy: [] });
    expect(sharedDependent).toMatchObject({ status: 'proposed', version: 1n, ready: false, blockedBy: [sharedPrerequisiteId], description: sharedDescription });
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
    const exactRaw = await exactResponse.text();
    lifecycle.evidence.rawReads.push({ label: 'real-SQL-seeded-task-GET', path: taskPath(project.id, exact.id), body: exactRaw });
    expect(exactRaw).toMatch(new RegExp(`"version"\\s*:\\s*${exactVersion}(?:,|})`));
    allowApprovalWrites([...[exact, blocked].map(({ id }) => ({ action: 'approve' as const, origin: origin(info), projectId: project.id, taskId: id, count: 1 })),
      { action: 'approve', origin: origin(info), projectId: sharedProjectId, taskId: sharedDependentId, count: 1 }]);
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
      const response = await authenticatedAPI(page.context().request).fetch(route.request(), { timeout: 15_000, maxRetries: 0 });
      expect(response.status()).toBe(201);
      uploadFetched.resolve();
      await within(uploadRelease.promise, 'active attachment upload response release', 60_000);
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
      uploadFinished.resolve();
    });
    await page.route(otherPattern, async (route) => {
      if (!holdOtherRead) { await route.continue(); return; }
      const response = await authenticatedAPI(page.context().request).fetch(route.request(), { timeout: 15_000, maxRetries: 0 });
      expect(response.status()).toBe(200);
      expect((await response.json() as { title: string }).title).toBe(otherTitle);
      otherFetched.resolve();
      await within(otherRelease.promise, 'background task detail response release', 60_000);
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
      otherFinished.resolve();
    });
    const submitted: string[] = [];
    const pattern = `**${taskPath(project.id, exact.id)}/approve`;
    await page.route(pattern, async (route) => {
      submitted.push(route.request().postData()!);
      const response = await lifecycle.capture(route, exact.id);
      expect(response.status()).toBe(200);
      expect(await response.text()).toMatch(new RegExp(`"version"\\s*:\\s*${exactVersion + 1n}(?:,|})`));
      fetched.resolve();
      await within(release.promise, 'pending approval response release', 60_000);
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
      finished.resolve();
    });
    try {
      const button = detail(page).getByRole('button', { name: '批准任务', exact: true });
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(confirmation(page).getByRole('button', { name: '取消', exact: true })).toBeFocused();
      expect(submitted).toEqual([]);
      await confirmAction(page);
      await within(fetched.promise, 'real exact-version approval commit');
      await expect(approval(page)).toHaveAttribute('aria-busy', 'true');
      await expect(detail(page).getByRole('button', { name: '正在提交…', exact: true })).toBeDisabled();
      await detail(page).locator('.task-detail-title-action').evaluate((element: HTMLButtonElement) => element.click());
      await page.keyboard.press('Escape');
      await expect(standalone(page, exact.id)).toBeFocused();
      await standalone(page, exact.id).click();
      await expect(approval(page)).toHaveAttribute('aria-busy', 'true');
      await expect(approval(page).getByRole('status')).toContainText('正在提交审批操作');
      await expect(detail(page).locator('.task-detail-title-action')).toBeDisabled();
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
      await expect(detail(page).getByRole('button', { name: '批准任务', exact: true, includeHidden: true })).toBeDisabled();
      await assertUploadRetained();
      otherRelease.resolve();
      await within(otherFinished.promise, 'fresh background task detail response');
      await expect(detail(page).locator('.task-detail-title')).toHaveText(updatedOther.title);
      await expect(detail(page).getByRole('button', { name: '批准任务', exact: true, includeHidden: true })).toBeEnabled();
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
      await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
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
    await expect(detail(page).getByRole('region', { name: '当前未完成的前置', exact: true })).toContainText(prerequisite.title);
    await page.setViewportSize({ width: 320, height: 740 });
    await detail(page).getByRole('combobox', { name: '语言 / Language', exact: true }).selectOption('en');
    await expectStatus(page, 'Proposed');
    await expectCenteredTaskDetail(page, detail(page));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const approve = detail(page).getByRole('button', { name: 'Approve task', exact: true });
    await approve.focus();
    const beforeApproval = await page.locator('.react-flow__viewport').getAttribute('style');
    const zoom = await page.locator('.react-flow__viewport').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
    const graphSubmitted = deferred();
    const graphRelease = deferred();
    const graphFinished = deferred();
    const graphApprovalPattern = `**${taskPath(project.id, blocked.id)}/approve`;
    await page.route(graphApprovalPattern, async (route) => {
      const response = await lifecycle.capture(route, blocked.id);
      expect(response.status()).toBe(200);
      graphSubmitted.resolve();
      await within(graphRelease.promise, 'graph approval response release');
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
      graphFinished.resolve();
    });
    try {
      await page.keyboard.press('Enter');
      await confirmAction(page, 'approve', 'en');
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
    await expect(detail(page).getByRole('button', { name: 'Approve task', exact: true })).toHaveCount(0);
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
    await test.step('installed CLI creation, ordinary graph Web approval and installed claim/complete', async () => {
      const exactShown = await lifecycle.success(['task', 'show', exact.id, '--project', project.id, '--json']);
      expect(exactShown).toMatch(/"version"\s*:\s*9223372036854775807(?:,|})/);
      expect(parseTaskDetail(parseApiJson(exactShown), project.id, exact.id).version).toBe(exactVersion + 1n);
      const plan = Buffer.from('# Acceptance plan\n\nPreserve every lifecycle field and the attached original bytes.\n');
      const binary = Buffer.from([0, 255, 128, 13, 10, 1, 254, 42, 0]);
      for (const [path, content] of [['plan.md', plan], ['payload.bin', binary]] as const) {
        const local = info.outputPath(`lifecycle-${path}`);
        await writeFile(local, content);
        await lifecycle.success(['task', 'attachment', 'put', sharedDependentId, local, '--path', path, '--project', sharedProjectId]);
        expect(await lifecycle.bytes(sharedProjectId, sharedDependentId, path, `created-${path}`)).toEqual(content);
      }
      expect(JSON.parse(await lifecycle.success(['task', 'ready', '--project', sharedProjectId, '--json']))).toEqual([]);
      const inventory = JSON.parse(await lifecycle.success(['task', 'list', '--project', sharedProjectId, '--status', 'proposed', '--json'])) as Record<string, unknown>[];
      expect(inventory).toHaveLength(2);
      for (const task of [sharedPrerequisite, sharedDependent]) {
        const { description: _description, version: _version, ...fields } = task;
        expect(inventory.find((item) => item.id === task.id)).toEqual({ ...fields, version: 1 });
      }
      const createdGraph = parseTaskGraph(JSON.parse(await lifecycle.success(['task', 'graph', '--project', sharedProjectId, '--json'])), sharedProjectId);
      expect(createdGraph.summary).toEqual({ total: 2, proposed: 2, todo: 0, inProgress: 0, done: 0, ready: 0, blocked: 0 });
      expect(createdGraph.tasks.find((task) => task.id === sharedDependentId)).toMatchObject({ status: 'proposed', dependsOn: [sharedPrerequisiteId], blockedBy: [sharedPrerequisiteId], ready: false });
      await page.goto(`/projects/${sharedProjectId}`);
      await page.clock.runFor(100);
      await expect(page.locator('.task-graph-fullscreen')).toHaveCount(0);
      await details(page, sharedDependentId).click();
      await expectStatus(page, '待审批');
      await expect(detail(page).locator('.task-description')).toContainText('Lifecycle delivery');
      const ordinaryPattern = `**${taskPath(sharedProjectId, sharedDependentId)}/approve`;
      await page.route(ordinaryPattern, async (route) => {
        const response = await lifecycle.capture(route, sharedDependentId);
        expect(response.status()).toBe(200);
        expect(route.request().postData()).toBe('{"version":1}');
        await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
      });
      try {
        await submitApproval(page);
        await expectStatus(page, '待处理');
        await expect(detail(page).locator('.task-detail-blocked')).toHaveText('被阻塞');
        const approved = await lifecycle.show(sharedProjectId, sharedDependentId, 'web-approved-blocked');
        expect(approved).toMatchObject({ status: 'todo', version: 2n, ready: false, blockedBy: [sharedPrerequisiteId] });
        expect(invariantFields(approved)).toEqual(invariantFields(sharedDependent));
        expect(approved.updatedAt).not.toBe(sharedDependent.updatedAt);
        const refused = await lifecycle.run(['task', 'claim', sharedDependentId, '--project', sharedProjectId, '--if-version', '2']);
        expect(refused.exitCode).toBe(1); expect(refused.stdout).toBe('');
        expect(refused.stderr).toContain('dependency_unsatisfied'); expect(refused.stderr).toContain(sharedPrerequisiteId);
        expect(await lifecycle.show(sharedProjectId, sharedDependentId, 'refused-claim-unchanged')).toEqual(approved);
        expect(JSON.parse(await lifecycle.success(['task', 'ready', '--project', sharedProjectId, '--json']))).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(details(page, sharedDependentId)).toBeFocused();
        let prior = sharedPrerequisite;
        for (const [action, status, expected] of [['approve', 'todo', 2n], ['claim', 'in_progress', 3n], ['complete', 'done', 4n]] as const) {
          await lifecycle.success(['task', action, sharedPrerequisiteId, '--project', sharedProjectId, '--if-version', String(prior.version)]);
          const current = await lifecycle.show(sharedProjectId, sharedPrerequisiteId, `prerequisite-${action}`);
          expect(current).toMatchObject({ status, version: expected });
          expect(invariantFields(current)).toEqual(invariantFields(sharedPrerequisite));
          expect(current.updatedAt).not.toBe(prior.updatedAt); prior = current;
        }
        const ready = await lifecycle.show(sharedProjectId, sharedDependentId, 'dependency-completed-ready');
        expect(ready).toEqual({ ...approved, ready: true, blockedBy: [] });
        const candidates = JSON.parse(await lifecycle.success(['task', 'ready', '--project', sharedProjectId, '--json'])) as Record<string, unknown>[];
        expect(candidates).toHaveLength(1); expect(candidates[0]).toMatchObject({ id: sharedDependentId, version: 2, description: sharedDescription, ready: true });
        await page.getByRole('button', { name: '刷新', exact: true }).click();
        await page.clock.runFor(100);
        await details(page, sharedDependentId).click();
        await expect(detail(page).locator('.task-detail-ready')).toHaveText('可开始');
        await page.keyboard.press('Escape');
        prior = ready;
        for (const [action, status, expected] of [['claim', 'in_progress', 3n], ['complete', 'done', 4n]] as const) {
          await lifecycle.success(['task', action, sharedDependentId, '--project', sharedProjectId, '--if-version', String(prior.version)]);
          const current = await lifecycle.show(sharedProjectId, sharedDependentId, `dependent-${action}`);
          expect(current).toMatchObject({ status, version: expected, ready: false, blockedBy: [] });
          expect(invariantFields(current)).toEqual(invariantFields(sharedDependent));
          expect(current.updatedAt).not.toBe(prior.updatedAt); prior = current;
        }
        expect(prior.description).toBe(sharedDescription);
        expect(JSON.parse(await lifecycle.success(['task', 'list', '--project', sharedProjectId, '--json']))).toEqual([]);
        const all = JSON.parse(await lifecycle.success(['task', 'list', '--project', sharedProjectId, '--all', '--json'])) as Record<string, unknown>[];
        expect(all).toHaveLength(2); expect(all.every((item) => item.status === 'done' && item.version === 4 && !Object.hasOwn(item, 'description'))).toBe(true);
        const completedGraph = parseTaskGraph(JSON.parse(await lifecycle.success(['task', 'graph', '--project', sharedProjectId, '--json'])), sharedProjectId);
        expect(completedGraph.summary).toEqual({ total: 2, proposed: 0, todo: 0, inProgress: 0, done: 2, ready: 0, blocked: 0 });
        for (const [path, content] of [['plan.md', plan], ['payload.bin', binary]] as const) expect(await lifecycle.bytes(sharedProjectId, sharedDependentId, path, `completed-${path}`)).toEqual(content);
        await page.getByRole('button', { name: '刷新', exact: true }).click();
        await expect(page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: /^已完成$/ }) }).locator('.stat-number')).toHaveText('2');
        await page.getByRole('checkbox', { name: '显示已完成任务链（1）', exact: true }).check();
        const root = page.locator(`#task-root-${sharedPrerequisiteId}`);
        if (await root.getAttribute('aria-expanded') !== 'true') await root.click();
        await page.clock.runFor(100);
        await details(page, sharedDependentId).click();
        await expect(detail(page).locator('.task-detail-status')).toHaveText('已完成');
        await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
        await screenshot(page, info, 'task-approval-installed-lifecycle');
      } finally { await page.unroute(ordinaryPattern); }
    });
  } finally {
    try { await lifecycle.attach(); } finally { await lifecycle.close(); }
  }
});

test('task-approval-conflicts', scenario('task-approval-conflicts'), async ({ page, api: request, allowApprovalWrites }, info) => {
  await pauseAutomaticRefresh(page);
  const lifecycle = await lifecycleActor(page, info, 'task-approval-conflicts');
  try {
    const project = await createProject(request, { name: `Approval conflict ${randomUUID()}` });
    const changed = await createProposedTask(request, project.id, { title: '批准前内容变化', description: '最初审阅的说明' });
    const external = await createProposedTask(request, project.id, { title: '已被其他调用方批准' });
    const raceId = resourceId(await lifecycle.success(['task', 'create', '--project', project.id, '--title', 'CLI/Web same observed version', '--description', 'Two actual clients approve one observed proposal.']));
    const raceBefore = await lifecycle.show(project.id, raceId, 'race-created-and-observed');
    allowApprovalWrites([
      { action: 'approve', origin: origin(info), projectId: project.id, taskId: changed.id, count: 2 },
      { action: 'approve', origin: origin(info), projectId: project.id, taskId: external.id, count: 1 },
      { action: 'approve', origin: origin(info), projectId: project.id, taskId: raceId, count: 1 },
    ]);
    const posts: string[] = [];
    page.on('request', (value) => { if (value.method() === 'POST') posts.push(value.url()); });
    await page.goto(`/projects/${project.id}`);
    await openStandalone(page, changed.id);
    const changedBefore = await lifecycle.show(project.id, changed.id, 'browser-reviewed-before-CLI-update');
    await lifecycle.success(['task', 'update', changed.id, '--project', project.id, '--if-version', String(changedBefore.version), '--description', '需要重新审阅的当前说明']);
    const updated = await lifecycle.show(project.id, changed.id, 'CLI-metadata-updated');
    expect(updated.version).toBe(changedBefore.version + 1n);
    const stalePattern = `**${taskPath(project.id, changed.id)}/approve`;
    await page.route(stalePattern, async (route) => {
      const response = await lifecycle.capture(route, changed.id);
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
    });
    await submitApproval(page);
    await expect(detail(page).locator('.task-description')).toHaveText(updated.description);
    await expect(approval(page).getByRole('alert').first()).toContainText('任务已变化');
    await expect(approval(page)).toContainText('任务版本已变化');
    await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toBeEnabled();
    expect(posts).toHaveLength(1);
    expect(lifecycle.evidence.webWrites[0]).toMatchObject({ taskId: changed.id, expectedBody: `{"version":${changedBefore.version}}`, status: 409 });
    expect(JSON.parse(lifecycle.evidence.webWrites[0]!.responseBody).error.code).toBe('version_conflict');
    const current = await request.get(taskPath(project.id, changed.id));
    expect((await current.json() as { status: string }).status).toBe('proposed');
    await screenshot(page, info, 'task-approval-version-conflict');
    await submitApproval(page);
    await expectStatus(page, '待处理');
    expect(posts).toHaveLength(2);
    expect(lifecycle.evidence.webWrites[1]).toMatchObject({ expectedBody: `{"version":${updated.version}}`, status: 200 });
    await page.unroute(stalePattern);
    await page.keyboard.press('Escape');
    await standalone(page, external.id).click();
    await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toBeEnabled();
    const externalPattern = `**${taskPath(project.id, external.id)}/approve`;
    await page.route(externalPattern, async (route) => {
      const response = await lifecycle.capture(route, external.id);
      expect(response.status()).toBe(409);
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
    });
    await lifecycle.success(['task', 'approve', external.id, '--project', project.id, '--if-version', String(external.version)]);
    expect(await lifecycle.show(project.id, external.id, 'CLI-approved-other-caller')).toMatchObject({ status: 'todo', version: 2n });
    await submitApproval(page);
    await expectStatus(page, '待处理');
    await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
    expect(posts).toHaveLength(3);
    await page.unroute(externalPattern);
    await screenshot(page, info, 'task-approval-conflicts');
    await test.step('CLI and Web approve one observed version without automatic retry', async () => {
      await page.keyboard.press('Escape');
      await standalone(page, raceId).click();
      await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toBeEnabled();
      const browserStarted = deferred(); const release = deferred(); const finished = deferred();
      const racePattern = `**${taskPath(project.id, raceId)}/approve`;
      lifecycle.evidence.controlledFaults.push('The browser request is held before forwarding only as a dispatch barrier; the CLI and Web submit the same observed version to the real service, which chooses the winner.');
      await page.route(racePattern, async (route) => {
        expect(route.request().postData()).toBe(`{"version":${raceBefore.version}}`);
        browserStarted.resolve();
        await within(release.promise, 'concurrent approval dispatch');
        const response = await lifecycle.capture(route, raceId);
        expect([200, 409]).toContain(response.status());
        await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() }); finished.resolve();
      });
      try {
        await submitApproval(page);
        await within(browserStarted.promise, 'browser observed-version submission');
        await expect(detail(page).getByRole('button', { name: '正在提交…', exact: true })).toBeDisabled();
        await detail(page).getByRole('button', { name: '正在提交…', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
        await page.keyboard.press('Enter');
        const cliAttempt = lifecycle.run(['task', 'approve', raceId, '--project', project.id, '--if-version', String(raceBefore.version)]);
        release.resolve();
        const [cliResult] = await Promise.all([cliAttempt, within(finished.promise, 'real concurrent browser approval result')]);
        const browserResult = lifecycle.evidence.webWrites.filter((row) => row.taskId === raceId);
        expect(browserResult).toHaveLength(1);
        const browserStatus = browserResult[0]!.status;
        if (browserStatus === 200) {
          expect(cliResult.exitCode).toBe(1); expect(cliResult.stdout).toBe('');
          expect(cliResult.stderr).toContain('version_conflict');
          expect(cliResult.stderr).toContain(raceId);
        } else {
          expect(cliResult.exitCode).toBe(0); expect(cliResult.stderr).toBe('');
          expect(cliResult.stdout).toContain('Task approved.');
          expect(cliResult.stdout).toContain('Status: todo');
          expect(JSON.parse(browserResult[0]!.responseBody).error.code).toBe('version_conflict');
          await expect(approval(page)).toContainText('任务版本已变化');
        }
        await expectStatus(page, '待处理');
        await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
        const persisted = await lifecycle.show(project.id, raceId, 'one-authoritative-approval-winner');
        expect(persisted).toMatchObject({ status: 'todo', version: raceBefore.version + 1n });
        expect(invariantFields(persisted)).toEqual(invariantFields(raceBefore));
        expect(persisted.updatedAt).not.toBe(raceBefore.updatedAt);
        expect(posts).toHaveLength(4);
        await screenshot(page, info, 'task-approval-CLI-Web-race');
      } finally { release.resolve(); await page.unroute(racePattern); }
    });
  } finally {
    try { await lifecycle.attach(); } finally { await lifecycle.close(); }
  }
});

test('task-approval-recovery', scenario('task-approval-recovery'), async ({ page, api: request, allowApprovalWrites }, info) => {
  await pauseAutomaticRefresh(page);
  const lifecycle = await lifecycleActor(page, info, 'task-approval-recovery');
  try {
    const project = await createProject(request, { name: `Approval recovery ${randomUUID()}` });
    const unknown = await createProposedTask(request, project.id, { title: '响应丢失但已批准' });
    const graphFailure = await createProposedTask(request, project.id, { title: '保留已确认批准结果' });
    const stale = await createProposedTask(request, project.id, { title: '迟到的详情响应' });
    const pendingId = resourceId(await lifecycle.success(['task', 'create', '--project', project.id, '--title', 'Pending approval across real project navigation']));
    const otherProject = await createProject(request, { name: `Isolated approval project ${randomUUID()}` });
    const otherId = resourceId(await lifecycle.success(['task', 'create', '--project', otherProject.id, '--title', 'Other project stays proposed']));
    const otherBefore = await lifecycle.show(otherProject.id, otherId, 'other-project-before-pending-navigation');
    allowApprovalWrites([...[unknown, graphFailure].map(({ id }) => ({ action: 'approve' as const, origin: origin(info), projectId: project.id, taskId: id, count: 1 })),
      { action: 'approve', origin: origin(info), projectId: project.id, taskId: pendingId, count: 1 }]);
    lifecycle.evidence.controlledFaults.push('Actual approval POST is forwarded through the authenticated browser request context and commits before its response is aborted; reconciliation GET is temporarily aborted separately.');
    lifecycle.evidence.controlledFaults.push('The existing owned dependency table is temporarily renamed only around the real graph GET; its real500 response is forwarded, then the table is restored before CLI readback.');
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
      const response = await lifecycle.capture(route, unknown.id);
      expect(response.status()).toBe(200);
      await route.abort('connectionfailed');
    });
    try {
      await submitApproval(page);
      await expect(approval(page)).toContainText('审批操作结果尚未确认');
      await expect(approval(page)).toContainText('暂时无法确认当前任务状态');
      await expect(approval(page)).toContainText('审批操作未能从服务取得可确认的响应');
      await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toBeDisabled();
      const persisted = await request.get(taskPath(project.id, unknown.id));
      expect((await persisted.json() as { status: string }).status).toBe('todo');
      expect(await lifecycle.show(project.id, unknown.id, 'committed-before-lost-browser-response')).toMatchObject({ status: 'todo', version: 2n });
      await screenshot(page, info, 'task-approval-unknown');
      rejectReconciliation = false;
      await approval(page).getByRole('button', { name: '检查任务状态', exact: true }).click();
      await expectStatus(page, '待处理');
      await expect(approval(page)).toContainText('已确认当前任务状态');
      await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
    } finally {
      await page.unroute(unknownReadPattern);
      await page.unroute(unknownPostPattern);
    }
    await page.keyboard.press('Escape');
    await standalone(page, graphFailure.id).click();
    await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toBeEnabled();
    let failGraph = true;
    const graphPattern = `**${graphPath(project.id)}`;
    const graphPostPattern = `**${taskPath(project.id, graphFailure.id)}/approve`;
    await page.route(graphPostPattern, async (route) => {
      const response = await lifecycle.capture(route, graphFailure.id);
      expect(response.status()).toBe(200);
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
    });
    await page.route(graphPattern, async (route) => {
      if (!failGraph) { await route.continue(); return; }
      const response = await withDependencyFailure(async () => authenticatedAPI(page.context().request).fetch(route.request(), { timeout: 15_000, maxRetries: 0 }));
      expect(response.status()).toBe(500);
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
    });
    try {
      await submitApproval(page);
      await expectStatus(page, '待处理');
      await expect(approval(page).getByRole('status')).toContainText('批准成功');
      await expect(detail(page).locator('.task-detail-stale')).toContainText('结果已保留');
      await expect(page.locator('.snapshot-error')).toBeVisible();
      await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
      await screenshot(page, info, 'task-approval-confirmed-graph-failure');
      expect(await lifecycle.show(project.id, graphFailure.id, 'confirmed-todo-despite-graph-failure')).toMatchObject({ status: 'todo', version: 2n });
      failGraph = false;
      await detail(page).getByRole('button', { name: '刷新任务图', exact: true }).click();
      await expect(detail(page).locator('.task-detail-stale')).toHaveCount(0);
      await expectStatus(page, '待处理');
    } finally { await page.unroute(graphPattern); await page.unroute(graphPostPattern); }
    await page.keyboard.press('Escape');
    const fetched = deferred();
    const release = deferred();
    const finished = deferred();
    const stalePattern = `**${taskPath(project.id, stale.id)}`;
    await page.route(stalePattern, async (route) => {
      const response = await authenticatedAPI(page.context().request).fetch(route.request(), { timeout: 15_000, maxRetries: 0 });
      expect(response.status()).toBe(200);
      fetched.resolve();
      await within(release.promise, 'stale task detail release');
      if (route.request().failure() !== null) await route.abort('aborted');
      else await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
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
      await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
      await screenshot(page, info, 'task-approval-recovery');
    } finally {
      release.resolve();
      await page.unroute(stalePattern);
    }
    await test.step('pending approval survives SPA project changes and never paints another project', async () => {
      await page.keyboard.press('Escape');
      await standalone(page, pendingId).click();
      await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toBeEnabled();
      const fetched = deferred(); const release = deferred(); const finished = deferred();
      const pattern = `**${taskPath(project.id, pendingId)}/approve`;
      const documentId = randomUUID();
      await page.evaluate((value) => { Reflect.set(window, 'approvalLifecycleDocument', value); }, documentId);
      const otherReads: string[] = [];
      page.on('request', (read) => {
        if (read.method() === 'GET' && [graphPath(otherProject.id), taskPath(otherProject.id, otherId)].includes(new URL(read.url()).pathname)) otherReads.push(read.url());
      });
      lifecycle.evidence.controlledFaults.push('A real committed200 approval response is held across same-document project navigation; its status/body are forwarded unchanged on explicit release.');
      await page.route(pattern, async (route) => {
        expect(route.request().postData()).toBe('{"version":1}');
        const response = await lifecycle.capture(route, pendingId);
        expect(response.status()).toBe(200);
        fetched.resolve();
        await within(release.promise, 'pending approval across project navigation', 60_000);
        await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() }); finished.resolve();
      });
      try {
        await submitApproval(page);
        await within(fetched.promise, 'real pending project approval commit');
        await expect(approval(page)).toHaveAttribute('aria-busy', 'true');
        await page.keyboard.press('Escape');
        await navigateProject(page, otherProject.id);
        await openStandalone(page, otherId);
        await expect(detail(page).locator('.task-detail-title')).toHaveText(otherBefore.title);
        await expectStatus(page, '待审批');
        await page.keyboard.press('Escape');
        await navigateProject(page, project.id);
        await page.getByRole('tab', { name: '独立任务', exact: true }).click();
        await standalone(page, pendingId).click();
        await expect(approval(page)).toHaveAttribute('aria-busy', 'true');
        await expect(detail(page).getByRole('button', { name: '正在提交…', exact: true })).toBeDisabled();
        await detail(page).getByRole('button', { name: '正在提交…', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
        expect(lifecycle.evidence.webWrites.filter((row) => row.taskId === pendingId)).toHaveLength(1);
        await page.keyboard.press('Escape');
        await navigateProject(page, otherProject.id);
        await openStandalone(page, otherId);
        const readsBeforeSettlement = otherReads.length;
        release.resolve();
        await within(finished.promise, 'late original-project response');
        expect(await lifecycle.show(project.id, pendingId, 'original-project-authoritative-todo')).toMatchObject({ status: 'todo', version: 2n });
        expect(await lifecycle.show(otherProject.id, otherId, 'other-project-after-late-response')).toEqual(otherBefore);
        expect(otherReads).toHaveLength(readsBeforeSettlement);
        await expect(detail(page).locator('.task-detail-title')).toHaveText(otherBefore.title);
        await expectStatus(page, '待审批');
        expect(await page.evaluate(() => Reflect.get(window, 'approvalLifecycleDocument'))).toBe(documentId);
        await page.keyboard.press('Escape');
        await navigateProject(page, project.id);
        await page.getByRole('tab', { name: '独立任务', exact: true }).click();
        await standalone(page, pendingId).click();
        await expectStatus(page, '待处理');
        await expect(detail(page).getByRole('button', { name: '批准任务', exact: true })).toHaveCount(0);
        expect(lifecycle.evidence.webWrites.filter((row) => row.taskId === pendingId)).toHaveLength(1);
        await screenshot(page, info, 'task-approval-real-project-navigation');
      } finally { release.resolve(); await page.unroute(pattern); }
    });
  } finally {
    try { await lifecycle.attach(); } finally { await lifecycle.close(); }
  }
});

test('task-unapproval', scenario('task-unapproval'), async ({ page, allowApprovalWrites }, info) => {
  await pauseAutomaticRefresh(page);
  const lifecycle = await lifecycleActor(page, info, 'task-unapproval');
  try {
    const projectId = resourceId(await lifecycle.success(['project', 'create', `Withdraw approval ${randomUUID()}`, '--repo', `https://example.com/withdrawal/${randomUUID()}`]));
    const create = async (title: string, extra: readonly string[] = []): Promise<string> => resourceId(await lifecycle.success([
      'task', 'create', '--project', projectId, '--title', title, '--description', '# Withdrawal acceptance\n\nPreserve the reviewed task and its original materials.',
      '--pull-request-url', 'https://example.com/pull/withdrawal', '--pull-request-title', 'Preserved approval evidence', ...extra,
    ]));
    const longTitle = 'Long task title '.repeat(100);
    const readyId = await create(longTitle);
    const prerequisiteId = await create('仍未完成的撤回验收前置');
    const blockedId = await create('撤回仍被前置阻塞的任务', ['--depends-on', prerequisiteId]);
    const unknownId = await create('撤回已提交但浏览器响应丢失');
    for (const id of [readyId, blockedId, unknownId]) await lifecycle.success(['task', 'approve', id, '--project', projectId, '--if-version', '1']);
    const exactVersion = 9_007_199_254_740_993n;
    await seedTaskVersion(projectId, readyId, exactVersion);
    const before = await lifecycle.show(projectId, readyId, 'ready-todo-before-withdrawal');
    const blockedBefore = await lifecycle.show(projectId, blockedId, 'blocked-todo-before-withdrawal');
    const unknownBefore = await lifecycle.show(projectId, unknownId, 'unknown-todo-before-withdrawal');
    expect(before).toMatchObject({ status: 'todo', ready: true, version: exactVersion });
    expect(blockedBefore).toMatchObject({ status: 'todo', ready: false, blockedBy: [prerequisiteId] });
    const materials = [['plan.md', Buffer.from('# Solution\n\nRetain approval materials.\n\n## Acceptance criteria\n\nTask identity and bytes remain unchanged.\n')],
      ['evidence.bin', Buffer.from([0, 255, 13, 10, 128, 1, 0, 254])]] as const;
    for (const [path, bytes] of materials) {
      const local = info.outputPath(`withdrawal-${path}`);
      await writeFile(local, bytes);
      await lifecycle.success(['task', 'attachment', 'put', readyId, local, '--path', path, '--project', projectId]);
      expect(await lifecycle.bytes(projectId, readyId, path, `before-${path}`)).toEqual(bytes);
    }
    allowApprovalWrites([
      { action: 'unapprove', origin: origin(info), projectId, taskId: readyId, count: 1 },
      { action: 'approve', origin: origin(info), projectId, taskId: readyId, count: 1 },
      { action: 'unapprove', origin: origin(info), projectId, taskId: blockedId, count: 1 },
      { action: 'unapprove', origin: origin(info), projectId, taskId: unknownId, count: 1 },
    ]);
    await page.goto(`/projects/${projectId}`);
    await page.getByRole('tab', { name: '独立任务', exact: true }).click();
    await standalone(page, readyId).click();
    await expectStatus(page, '待处理');
    const withdraw = await expectTitleAction(page, '撤回审批');
    const expectLongTitleReading = async (phase: string): Promise<void> => {
      for (const height of [812, 400]) {
        await page.setViewportSize({ width: 375, height });
        const heading = detail(page).locator('.task-detail-heading');
        const title = heading.locator('.task-detail-title');
        expect(await title.textContent()).toBe(longTitle);
        await heading.evaluate((element) => { element.scrollTop = 0; });
        await expect.poll(() => detail(page).evaluate((element) => {
          const body = element.querySelector('.task-detail-body')!.getBoundingClientRect();
          const tabs = element.querySelector('.task-detail-tabs')!.getBoundingClientRect();
          const panel = element.querySelector('.task-detail-panel:not([hidden])')!.getBoundingClientRect();
          const title = element.querySelector('.task-detail-title')!.getBoundingClientRect();
          const action = element.querySelector('.task-detail-title-action')!.getBoundingClientRect();
          return tabs.y >= body.y && tabs.bottom <= body.bottom && panel.y >= tabs.bottom - 1
            && panel.bottom <= body.bottom + 1 && panel.height >= 40 && action.x >= title.right
            && element.scrollWidth <= element.clientWidth;
        }), { message: `${phase}: long title leaves visible tabs and a usable reading panel at 375x${height}` }).toBe(true);
        await title.focus();
        await page.keyboard.press('End');
        await page.clock.runFor(300);
        await expect.poll(() => heading.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1),
          { message: `${phase}: native keyboard scrolling reaches the complete title` }).toBe(true);
        const readError = detail(page).locator('.task-detail-read-error');
        if (await readError.count() !== 0) {
          await readError.focus();
          await page.keyboard.press('End');
          await page.clock.runFor(300);
          await expect.poll(() => readError.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);
        }
        await detail(page).locator('.task-detail-title-action').scrollIntoViewIfNeeded();
        await expect(detail(page).locator('.task-detail-title-action')).toBeInViewport({ ratio: 1 });
        await detail(page).locator('.task-detail-tabs').getByRole('tab').nth(1).click();
        await expect(detail(page).locator('.task-attachments .attachment-file').filter({ hasText: 'plan.md' })).toBeVisible();
        await detail(page).locator('.task-detail-tabs').getByRole('tab').nth(0).click();
        await screenshot(page, info, `task-unapproval-long-title-${phase}-${height}`);
      }
    };
    await expectLongTitleReading('normal');
    const longReadPattern = `**${taskPath(projectId, readyId)}`;
    lifecycle.evidence.controlledFaults.push('A real detail GET is forwarded while the owned dependency table is temporarily unavailable; the real500 response produces retained-read-error beside the persisted1600-character title, then the table is restored.');
    await page.route(longReadPattern, async (route) => {
      const response = await withDependencyFailure(async () => authenticatedAPI(page.context().request).fetch(route.request(), { timeout: 15_000, maxRetries: 0 }));
      expect(response.status()).toBe(500);
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
    });
    try {
      await page.clock.runFor(5_000);
      await expect(detail(page).locator('.task-detail-read-error')).toBeVisible();
      await expectLongTitleReading('retained-read-error');
    } finally { await page.unroute(longReadPattern); }
    await detail(page).locator('.task-detail-read-error').getByRole('button', { name: '重试详情', exact: true }).click();
    await expect(detail(page).locator('.task-detail-read-error')).toHaveCount(0);
    await page.setViewportSize({ width: 1600, height: 1100 });
    await expect(withdraw).toBeEnabled();
    const readyPattern = `**${taskPath(projectId, readyId)}/unapprove`;
    const fetched = deferred(); const release = deferred(); const finished = deferred();
    await page.route(readyPattern, async (route) => {
      expect(route.request().postData()).toBe(`{"version":${exactVersion}}`);
      const response = await lifecycle.capture(route, readyId);
      expect(response.status()).toBe(200);
      expect(await response.text()).toMatch(new RegExp(`"version"\\s*:\\s*${exactVersion + 1n}(?:,|})`));
      fetched.resolve();
      await within(release.promise, 'committed withdrawal response release');
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
      finished.resolve();
    });
    try {
      await withdraw.click();
      const dialog = confirmation(page, 'unapprove');
      await expect(dialog).toContainText(before.title);
      await expect(dialog).toContainText('待审批');
      await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
      expect(lifecycle.evidence.webWrites).toEqual([]);
      expect(await withdraw.evaluate((button) => button.closest('[inert]') !== null)).toBe(true);
      for (let index = 0; index < 4; index++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(withdraw).toBeFocused();
      await expectStatus(page, '待处理');
      expect(lifecycle.evidence.webWrites).toEqual([]);
      await withdraw.click();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(withdraw).toBeFocused();
      await expect(detail(page)).toBeVisible();
      expect(lifecycle.evidence.webWrites).toEqual([]);
      await withdraw.click();
      await screenshot(page, info, 'task-unapproval-confirmation');
      await confirmAction(page, 'unapprove');
      await within(fetched.promise, 'real exact-version withdrawal commit');
      await expect(detail(page).locator('.task-detail-title-action')).toBeDisabled();
      await detail(page).locator('.task-detail-title-action').evaluate((button: HTMLButtonElement) => button.click());
      await page.keyboard.press('Escape');
      await standalone(page, readyId).click();
      await expect(detail(page).locator('.task-detail-title-action')).toBeDisabled();
      expect(lifecycle.evidence.webWrites.filter((row) => row.taskId === readyId)).toHaveLength(1);
      const staleGraphPattern = `**${graphPath(projectId)}`;
      await page.route(staleGraphPattern, async (route) => {
        const response = await withDependencyFailure(async () => authenticatedAPI(page.context().request).fetch(route.request(), { timeout: 15_000, maxRetries: 0 }));
        expect(response.status()).toBe(500);
        await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
      });
      try {
        release.resolve();
        await within(finished.promise, 'withdrawal result displayed after reopening');
        await expectStatus(page, '待审批');
        await expect(detail(page).locator('.task-detail-stale')).toBeVisible();
        await expectLongTitleReading('stale-graph');
      } finally { await page.unroute(staleGraphPattern); }
      await detail(page).locator('.task-detail-stale').getByRole('button', { name: '刷新任务图', exact: true }).click();
      await expect(detail(page).locator('.task-detail-stale')).toHaveCount(0);
      await page.setViewportSize({ width: 1600, height: 1100 });
    } finally { release.resolve(); await page.unroute(readyPattern); }
    const withdrawn = await lifecycle.show(projectId, readyId, 'ready-withdrawal-persisted');
    expect(withdrawn).toMatchObject({ status: 'proposed', ready: false, version: exactVersion + 1n });
    expect(approvalInvariantFields(withdrawn)).toEqual(approvalInvariantFields(before));
    for (const [path, bytes] of materials) expect(await lifecycle.bytes(projectId, readyId, path, `withdrawn-${path}`)).toEqual(bytes);
    const candidates = JSON.parse(await lifecycle.success(['task', 'ready', '--project', projectId, '--json'])) as { id: string }[];
    expect(candidates.some((task) => task.id === readyId)).toBe(false);
    const attachmentsTab = detail(page).locator('.task-detail-tabs').getByRole('tab').nth(1);
    await attachmentsTab.click();
    const attachments = detail(page).locator('.task-attachments');
    await attachments.locator('.attachment-file').filter({ hasText: 'plan.md' }).click();
    await expect(attachments.locator('.markdown-content')).toContainText('Retain approval materials');
    await attachments.locator('.attachment-upload-disclosure summary').click();
    const pathDraft = attachments.locator('input[type=text]');
    await pathDraft.fill('retained-confirmation-draft.txt');
    const originalInput = await pathDraft.elementHandle();
    if (originalInput === null) throw new Error('The attachment draft input is missing.');
    await page.setViewportSize({ width: 320, height: 740 });
    await detail(page).getByRole('combobox', { name: '语言 / Language', exact: true }).selectOption('en');
    const approve = await expectTitleAction(page, 'Approve task');
    await approve.click();
    const approveDialog = confirmation(page, 'approve', 'en');
    await expect(approveDialog).toContainText(before.title);
    await expect(approveDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    const confirmationBody = approveDialog.locator('.dialog-body');
    await confirmationBody.focus();
    await page.keyboard.press('End');
    await page.clock.runFor(300);
    await expect.poll(() => confirmationBody.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.y >= 0 && bounds.bottom <= innerHeight && bounds.height >= 40
        && element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
    }), { message: 'The full persisted long title remains keyboard-readable inside the bounded confirmation body' }).toBe(true);
    expect(lifecycle.evidence.webWrites.filter((row) => row.taskId === readyId)).toHaveLength(1);
    await lifecycle.success(['task', 'update', readyId, '--project', projectId, '--if-version', String(withdrawn.version), '--description', 'The confirmation must be reviewed again after a metadata change.']);
    const changed = await lifecycle.show(projectId, readyId, 'proposal-changed-while-confirmation-open');
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === graphPath(projectId));
    await page.clock.runFor(5_000);
    expect((await refreshed).status()).toBe(200);
    await expect(approveDialog).toHaveCount(0);
    await expect(approve).toBeEnabled();
    expect(lifecycle.evidence.webWrites.filter((row) => row.taskId === readyId)).toHaveLength(1);
    await expect(attachmentsTab).toHaveAttribute('aria-selected', 'true');
    await expect(pathDraft).toHaveValue('retained-confirmation-draft.txt');
    expect(await originalInput.evaluate((element) => element.isConnected && element === document.querySelector('.task-attachments input[type=text]'))).toBe(true);
    const approvePattern = `**${taskPath(projectId, readyId)}/approve`;
    await page.route(approvePattern, async (route) => {
      expect(route.request().postData()).toBe(`{"version":${changed.version}}`);
      const response = await lifecycle.capture(route, readyId);
      expect(response.status()).toBe(200);
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
    });
    try {
      await approve.click();
      await screenshot(page, info, 'task-approval-title-confirmation-narrow');
      await confirmAction(page, 'approve', 'en');
      await expectStatus(page, 'To do');
      await expectTitleAction(page, 'Unapprove task');
      await expect(attachmentsTab).toHaveAttribute('aria-selected', 'true');
      await expect(pathDraft).toHaveValue('retained-confirmation-draft.txt');
      expect(await originalInput.evaluate((element) => element.isConnected)).toBe(true);
    } finally { await page.unroute(approvePattern); await originalInput.dispose(); }
    const reapproved = await lifecycle.show(projectId, readyId, 'reapproved-after-fresh-confirmation');
    expect(reapproved).toMatchObject({ status: 'todo', ready: true, version: changed.version + 1n });
    expect(approvalInvariantFields(reapproved)).toEqual(approvalInvariantFields(changed));
    for (const [path, bytes] of materials) expect(await lifecycle.bytes(projectId, readyId, path, `reapproved-${path}`)).toEqual(bytes);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.getByRole('combobox', { name: '语言 / Language', exact: true }).selectOption('zh-CN');
    await page.getByRole('tab', { name: '任务链', exact: true }).click();
    const root = page.locator(`#task-root-${prerequisiteId}`);
    if (await root.getAttribute('aria-expanded') !== 'true') await root.click();
    await page.clock.runFor(100);
    await details(page, blockedId).click();
    await expectTitleAction(page, '撤回审批');
    await expect(detail(page).locator('.task-detail-blocked')).toHaveText('被阻塞');
    const blockedPattern = `**${taskPath(projectId, blockedId)}/unapprove`;
    await page.route(blockedPattern, async (route) => {
      const response = await lifecycle.capture(route, blockedId);
      expect(response.status()).toBe(200);
      await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
    });
    try {
      await detail(page).getByRole('button', { name: '撤回审批', exact: true }).click();
      await confirmAction(page, 'unapprove');
      await expectStatus(page, '待审批');
    } finally { await page.unroute(blockedPattern); }
    const blockedAfter = await lifecycle.show(projectId, blockedId, 'blocked-withdrawal-persisted');
    expect(blockedAfter).toMatchObject({ status: 'proposed', ready: false, version: blockedBefore.version + 1n, blockedBy: [prerequisiteId] });
    expect(approvalInvariantFields(blockedAfter)).toEqual(approvalInvariantFields(blockedBefore));
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '独立任务', exact: true }).click();
    await standalone(page, unknownId).click();
    await expectTitleAction(page, '撤回审批');
    let rejectReconciliation = true;
    const unknownReadPattern = `**${taskPath(projectId, unknownId)}`;
    const unknownPostPattern = `${unknownReadPattern}/unapprove`;
    lifecycle.evidence.controlledFaults.push('The real unapprove POST commits before the browser response is aborted; reconciliation GET fails until an explicit recovery, with no repeated POST.');
    await page.route(unknownReadPattern, async (route) => {
      if (rejectReconciliation) await route.abort('connectionfailed'); else await route.continue();
    });
    await page.route(unknownPostPattern, async (route) => {
      const response = await lifecycle.capture(route, unknownId);
      expect(response.status()).toBe(200);
      await route.abort('connectionfailed');
    });
    try {
      await detail(page).getByRole('button', { name: '撤回审批', exact: true }).click();
      await confirmAction(page, 'unapprove');
      await expect(approval(page).getByRole('alert').first()).toBeVisible();
      await expect(detail(page).getByRole('button', { name: '撤回审批', exact: true })).toBeDisabled();
      const persisted = await lifecycle.show(projectId, unknownId, 'withdrawal-committed-before-lost-response');
      expect(persisted).toMatchObject({ status: 'proposed', ready: false, version: unknownBefore.version + 1n });
      expect(approvalInvariantFields(persisted)).toEqual(approvalInvariantFields(unknownBefore));
      await screenshot(page, info, 'task-unapproval-unknown');
      rejectReconciliation = false;
      await approval(page).getByRole('button', { name: '检查任务状态', exact: true }).click();
      await expectStatus(page, '待审批');
      await expectTitleAction(page, '批准任务');
      expect(lifecycle.evidence.webWrites.filter((row) => row.taskId === unknownId)).toHaveLength(1);
      await screenshot(page, info, 'task-unapproval');
    } finally { await page.unroute(unknownReadPattern); await page.unroute(unknownPostPattern); }
  } finally {
    try { await lifecycle.attach(); } finally { await lifecycle.close(); }
  }
});
