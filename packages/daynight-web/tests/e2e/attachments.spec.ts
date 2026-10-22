import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { attachmentDownloadUrl, attachmentPreviewUrl } from '../../src/api/client';
import { createAcceptanceCli } from '../../scripts/acceptance/installed-cli.mts';
import { createProject, createTask, expect, test, type Task } from './fixtures';
import { expectCenteredTaskDetail } from './detail-dialog';
import { hasPaintedPdfMarker, readPdfPixels, type PdfPixels } from './pdf-pixels';

const exact = (value: string): RegExp => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const asset = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const selectFile = async (region: Locator, path: string): Promise<void> => {
  let branch = region.getByRole('navigation', { name: '附件文件' }).locator(':scope > ul');
  const parts = path.split('/');
  for (const name of parts.slice(0, -1)) {
    const summary = branch.locator(':scope > li > details > summary').filter({ hasText: exact(`▱ ${name}`) });
    await expect(summary).toHaveCount(1);
    const directory = summary.locator('..');
    if (await directory.getAttribute('open') === null) await summary.click();
    branch = directory.locator(':scope > ul');
  }
  const name = branch.locator(':scope > li > button > .attachment-file-name').filter({ hasText: exact(parts.at(-1)!) });
  await expect(name).toHaveCount(1);
  await name.locator('..').click();
  await expect(region.getByRole('heading', { name: path, exact: true })).toBeVisible();
};

const paintedPdf = async (page: Page, frame: Locator, info: TestInfo, source: Buffer, url: string): Promise<PdfPixels> => {
  let painted: Buffer | undefined;
  let metrics: PdfPixels | undefined;
  await expect.poll(async () => {
    const png = await frame.screenshot({ animations: 'disabled' });
    const current = await page.evaluate(readPdfPixels, png.toString('base64'));
    if (!hasPaintedPdfMarker(current)) return false;
    painted = png;
    metrics = current;
    return true;
  }, { message: 'The native PDF viewer paints the solid fixture rectangle', timeout: 30_000, intervals: [100, 250, 500] }).toBe(true);
  if (painted === undefined || metrics === undefined) throw new Error('PDF paint evidence was not captured.');
  const screenshot = info.outputPath('task-attachments-pdf.png');
  const receipt = info.outputPath('task-attachments-pdf.json');
  await writeFile(screenshot, painted);
  await writeFile(receipt, `${JSON.stringify({ schemaVersion: 1, path: 'reports/brief.pdf', url, sha256: createHash('sha256').update(source).digest('hex'), markerRgb: [17, 203, 149], tolerance: 4, ...metrics }, null, 2)}\n`);
  await info.attach('painted-pdf', { path: screenshot, contentType: 'image/png' });
  await info.attach('painted-pdf-pixels', { path: receipt, contentType: 'application/json' });
  return metrics;
};

test('task-attachments', { annotation: { type: 'scenario', description: 'task-attachments' } }, async ({ page, request, allowAttachmentWrites }, info) => {
  const project = await createProject(request, { name: `Attachments ${randomUUID()}` });
  const task = await createTask(request, project.id, { title: 'CLI 与 Web 共享同一任务附件', description: '验证文件内容、预览和单文件操作。' });
  const baseURL = info.project.use.baseURL;
  if (typeof baseURL !== 'string') throw new Error('Attachment acceptance requires the actual service base URL.');
  const directory = info.outputPath('attachment-files');
  await mkdir(directory, { recursive: true });
  const cli = await createAcceptanceCli(baseURL, info.outputPath('installed-cli'));
  const command = async (args: readonly string[]): Promise<string> => {
    const result = await cli.run(args);
    expect(result.exitCode, `Installed CLI succeeds: ${args.join(' ')}`).toBe(0);
    expect(result.stderr, 'Successful installed CLI commands keep stderr empty').toBe('');
    return result.stdout;
  };
  const args = (operation: string, values: readonly string[] = []): string[] => ['task', 'attachment', operation, task.id, ...values, '--project', project.id];
  const put = async (path: string, bytes: Buffer, index: string): Promise<void> => {
    const source = join(directory, `${index}.data`);
    await writeFile(source, bytes);
    await command(args('put', [source, '--path', path]));
  };
  const binary = Buffer.from([0, 255, 1, 128, 13, 10, 200, 0, 254, 42]);
  const pdf = await readFile(asset('../mockups/files/brief.pdf'));
  const wideColumns = Array.from({ length: 16 }, (_, index) => `Column ${index + 1}`);
  const wideTable = `| ${wideColumns.join(' | ')} |\n| ${wideColumns.map(() => '---').join(' | ')} |\n| ${wideColumns.map(() => 'Long table content').join(' | ')} |`;
  const longCode = `const attachmentContent = '${'unbroken-source-'.repeat(80)}';`;
  const longPath = `long/${'long-file-name-'.repeat(12)}.txt`;
  const seeds = [
    { path: 'docs/design.md', bytes: Buffer.from(`# 附件设计\n\n| 文件 | 状态 |\n| --- | --- |\n| Web | 已连接 |\n\n${wideTable}\n\n\`\`\`js\n${longCode}\n\`\`\`\n\n![项目流程](../images/workflow.svg)\n\n[同名文本](../notes/one/same.txt)\n\n<script>window.attachmentLeak = true</script>\n`) },
    { path: 'notes/one/same.txt', bytes: Buffer.from('First nested text\nSecond line\n') },
    { path: 'notes/two/same.txt', bytes: Buffer.from('Second same-name text\n') },
    { path: 'empty.txt', bytes: Buffer.alloc(0) },
    { path: 'binary/bytes.bin', bytes: binary },
    { path: 'images/workflow.svg', bytes: await readFile(asset('../mockups/files/images/workflow.svg')) },
    { path: 'reports/brief.pdf', bytes: pdf },
    { path: 'site/index.html', bytes: await readFile(asset('./attachment-files/site/index.html')) },
    { path: 'site/style.css', bytes: await readFile(asset('../mockups/files/site/style.css')) },
    { path: 'site/app.js', bytes: await readFile(asset('./attachment-files/site/app.js')) },
    { path: longPath, bytes: Buffer.from('Long path attachment content\n'.repeat(200)) },
    { path: 'long/reading.md', bytes: await readFile(asset('../mockups/files/docs/tall.md')) },
    { path: 'long/reading.txt', bytes: await readFile(asset('../mockups/files/data/tall.txt')) },
    { path: 'long/reading.svg', bytes: await readFile(asset('../mockups/files/images/tall.svg')) },
    { path: 'long/reading.html', bytes: await readFile(asset('../mockups/files/site/tall.html')) },
    { path: 'long/reading.pdf', bytes: await readFile(asset('../mockups/files/tall.pdf')) },
    { path: 'site/data.json', bytes: await readFile(asset('./attachment-files/site/data.json')) },
  ];
  for (const [index, seed] of seeds.entries()) await put(seed.path, seed.bytes, `seed-${index}`);
  const listed = JSON.parse(await command(args('list', ['--json']))) as { path: string; sizeBytes: number }[];
  expect(listed.map(({ path }) => path)).toEqual(seeds.map(({ path }) => path).toSorted());
  expect(listed.find(({ path }) => path === 'empty.txt')?.sizeBytes).toBe(0);
  expect(await cli.read(args('read', ['binary/bytes.bin']))).toEqual(binary);
  expect(await cli.read(args('read', ['empty.txt']))).toEqual(Buffer.alloc(0));
  expect(await cli.read(args('read', ['reports/brief.pdf']))).toEqual(pdf);

  const uploadedPath = 'uploads/Web #? 空.bin';
  const origin = new URL(baseURL).origin;
  allowAttachmentWrites([
    { origin, method: 'PUT', projectId: project.id, taskId: task.id, path: uploadedPath, count: 2 },
    { origin, method: 'DELETE', projectId: project.id, taskId: task.id, path: uploadedPath, count: 1 },
  ]);
  let graphReads = 0;
  let detailReads = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === `/api/v1/projects/${project.id}/task-graph`) graphReads += 1;
    if (path === `/api/v1/projects/${project.id}/tasks/${task.id}`) detailReads += 1;
  });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '独立任务', exact: true }).click();
  const trigger = page.locator(`#standalone-task-${task.id}`);
  await expect(page.locator('.task-graph-canvas')).toHaveCount(0);
  const originalOverflow = await page.evaluate(() => ({ document: document.documentElement.style.overflow, body: document.body.style.overflow }));
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '任务详情' });
  const attachments = dialog.locator('.task-attachments');
  await expect(dialog.getByRole('tab', { name: '概览', exact: true })).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('tab', { name: '附件', exact: true }).click();
  const expectReleased = async (): Promise<void> => {
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => ({ document: document.documentElement.style.overflow, body: document.body.style.overflow }))).toEqual(originalOverflow);
  };
  await expect(attachments.getByRole('heading', { name: `附件 · ${seeds.length}`, exact: true })).toBeVisible();

  await selectFile(attachments, 'docs/design.md');
  await expect(attachments.getByRole('table').first()).toContainText('Web已连接');
  const markdownImage = attachments.getByRole('img', { name: '项目流程' });
  await expect(markdownImage).toHaveAttribute('src', attachmentPreviewUrl(project.id, task.id, 'images/workflow.svg'));
  await expect.poll(() => markdownImage.evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await expect(attachments.getByRole('link', { name: '同名文本' })).toHaveAttribute('href', attachmentPreviewUrl(project.id, task.id, 'notes/one/same.txt'));
  await expect(attachments.locator('script')).toHaveCount(0);
  await expect(attachments.getByText('<script>window.attachmentLeak = true</script>')).toBeVisible();
  expect(await page.evaluate(() => Object.hasOwn(window, 'attachmentLeak'))).toBe(false);
  await expect(attachments.locator('.attachment-markdown pre')).toHaveText(longCode);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expectCenteredTaskDetail(page, dialog);
    expect(await dialog.locator('.task-detail-body').evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
    const split = await attachments.locator('.attachment-split').boundingBox();
    const left = await attachments.locator('.attachment-sidebar').boundingBox();
    const right = await attachments.locator('.attachment-preview-pane').boundingBox();
    expect(split && left && right && left.x + left.width <= right.x + 1 && left.y === right.y && right.height === left.height).toBeTruthy();
    expect(await attachments.locator('.attachment-markdown pre').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    if (width === 320) expect(await attachments.getByRole('table').last().evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  }
  const scrollEvidence: unknown[] = [];
  for (const viewport of [{ width: 1440, height: 800 }, { width: 768, height: 800 }, { width: 600, height: 800 }, { width: 320, height: 800 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const extension of ['md', 'txt', 'svg', 'html', 'pdf']) {
      await selectFile(attachments, `long/reading.${extension}`);
      const body = attachments.locator('.attachment-preview-body');
      const native = extension === 'html' || extension === 'pdf';
      if (extension === 'svg') await expect.poll(() => attachments.getByRole('img').evaluate((image) => (image as HTMLImageElement).naturalHeight)).toBeGreaterThan(0);
      await expectCenteredTaskDetail(page, dialog);
      const panes = await attachments.locator('.attachment-sidebar,.attachment-preview-pane').evaluateAll((elements) => elements.map((element) => {
        const bounds = element.getBoundingClientRect(); return { left: bounds.left, right: bounds.right, top: bounds.top, height: bounds.height };
      }));
      expect(panes[0]!.right).toBeLessThanOrEqual(panes[1]!.left + 1);
      expect(panes[0]!.top).toBe(panes[1]!.top);
      expect(panes[1]!.height).toBeGreaterThan(80);
      for (const action of ['下载', '删除']) await expect(attachments.getByRole(action === '下载' ? 'link' : 'button', { name: action, exact: true })).toBeInViewport({ ratio: 1 });
      const outer = await body.evaluate((element) => {
        const chain = [];
        for (let node: Element | null = element; node !== null && !node.classList.contains('task-detail-backdrop'); node = node.parentElement) chain.push({ className: node.className, height: node.clientHeight, scrollHeight: node.scrollHeight, overflow: getComputedStyle(node).overflowY });
        return chain;
      });
      expect(outer.slice(1).filter((entry) => entry.scrollHeight > entry.height + 1)).toEqual([]);
      if (!native) {
        expect(outer[0]!.scrollHeight).toBeGreaterThan(outer[0]!.height);
        const bounds = await body.boundingBox();
        if (bounds === null) throw new Error('The preview scroll owner has no bounds.');
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.wheel(0, 180);
        await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await body.evaluate((element) => { element.scrollTop = 0; });
        await body.focus();
        await page.keyboard.press('PageDown');
        await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        const position = await body.evaluate((element) => element.scrollTop);
        const left = attachments.locator('.attachment-sidebar');
        await left.evaluate((element) => { element.scrollTop = element.scrollHeight; });
        expect(await body.evaluate((element) => element.scrollTop)).toBe(position);
        await left.evaluate((element) => { element.scrollTop = 0; });
      } else {
        const frame = attachments.locator('iframe');
        await expect(frame).toBeInViewport({ ratio: 1 });
        const frameBounds = await frame.boundingBox();
        const bodyBounds = await body.boundingBox();
        expect(frameBounds!.height).toBeCloseTo(bodyBounds!.height, 0);
        expect(outer[0]!.scrollHeight).toBeLessThanOrEqual(outer[0]!.height + 1);
        if (extension === 'html') {
          const content = frame.contentFrame();
          await expect(content.locator('#counter')).toBeVisible();
          expect(await content.locator('html').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
          await page.mouse.move(frameBounds!.x + frameBounds!.width / 2, frameBounds!.y + frameBounds!.height / 2);
          await page.mouse.wheel(0, 180);
          await expect.poll(() => content.locator('html').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
          await content.locator('html').evaluate((element) => { element.scrollTop = 0; });
          await content.locator('#counter').focus();
          await page.keyboard.press('PageDown');
          await expect.poll(() => content.locator('html').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        }
      }
      scrollEvidence.push({ viewport, extension, outer, panes });
    }
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await selectFile(attachments, longPath);
  await expect(attachments.getByRole('heading', { name: longPath, exact: true })).toHaveAttribute('title', longPath);
  for (const action of ['下载', '删除']) await expect(attachments.getByRole(action === '下载' ? 'link' : 'button', { name: action, exact: true })).toBeInViewport({ ratio: 1 });
  await info.attach('attachment-scroll-owners', { body: Buffer.from(JSON.stringify(scrollEvidence, null, 2)), contentType: 'application/json' });
  await page.setViewportSize({ width: 320, height: 800 });
  await selectFile(attachments, 'docs/design.md');
  const narrowScreenshot = info.outputPath('task-attachments-narrow.png');
  await page.screenshot({ path: narrowScreenshot, fullPage: false });
  await info.attach('task-attachments-narrow', { path: narrowScreenshot, contentType: 'image/png' });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await selectFile(attachments, 'notes/one/same.txt');
  await expect(attachments.locator('pre')).toHaveText('First nested text\nSecond line\n');
  const refreshedText = Buffer.from('CLI replacement appears after attachment refresh\n');
  await put('notes/one/same.txt', refreshedText, 'external-replacement');
  await attachments.getByRole('button', { name: '刷新附件', exact: true }).click();
  await expect(attachments.locator('pre')).toHaveText(refreshedText.toString('utf8'));
  await selectFile(attachments, 'notes/two/same.txt');
  await expect(attachments.locator('pre')).toHaveText('Second same-name text\n');
  await selectFile(attachments, 'empty.txt');
  await expect(attachments.locator('pre')).toHaveText('');
  await selectFile(attachments, 'images/workflow.svg');
  await expect.poll(() => attachments.getByRole('img').evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);

  await selectFile(attachments, 'site/index.html');
  const html = attachments.getByTitle('HTML 预览：site/index.html');
  await expect(html).toHaveAttribute('src', attachmentPreviewUrl(project.id, task.id, 'site/index.html'));
  await expect(html).not.toHaveAttribute('sandbox');
  const content = html.contentFrame();
  await expect(content.locator('#data')).toHaveText('Attachment same-data journey · in_progress');
  expect(await content.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor)).toBe('rgb(246, 247, 252)');
  await expect.poll(() => content.getByRole('img', { name: 'Project workflow' }).evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await content.getByRole('button', { name: '完成一个任务' }).click();
  await expect(content.locator('#result')).toHaveText('已完成 3 个任务');
  const innerButton = content.getByRole('button', { name: '完成一个任务' });
  const frameHandle = await html.elementHandle();
  const input = attachments.getByLabel('选择一个文件');
  const inputHandle = await input.elementHandle();
  await input.setInputFiles({ name: 'unsent.txt', mimeType: 'text/plain', buffer: Buffer.from('Unsent draft') });
  await attachments.getByRole('textbox', { name: '目标相对路径' }).fill('drafts/unsent.txt');
  const notes = attachments.locator('summary').filter({ hasText: exact('▱ notes') }).locator('..');
  await notes.locator('summary').first().click();
  await expect(notes).not.toHaveAttribute('open', '');
  await innerButton.focus();
  await dialog.getByRole('tab', { name: '概览', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: '概览', exact: true })).toBeFocused();
  await expect(dialog.locator('.task-detail-panel-attachments')).toHaveAttribute('inert', '');
  await expect(html).toBeHidden();
  await dialog.getByRole('tab', { name: '附件', exact: true }).click();
  expect(await frameHandle!.evaluate((element) => element === document.querySelector('.task-attachments iframe'))).toBe(true);
  expect(await inputHandle!.evaluate((element) => element === document.querySelector('.task-attachments input[type=file]'))).toBe(true);
  await expect(content.locator('#result')).toHaveText('已完成 3 个任务');
  await expect(attachments.getByRole('textbox', { name: '目标相对路径' })).toHaveValue('drafts/unsent.txt');
  expect(await input.evaluate((element) => (element as HTMLInputElement).files?.[0]?.name)).toBe('unsent.txt');
  await expect(notes).not.toHaveAttribute('open', '');
  await frameHandle!.dispose();
  await inputHandle!.dispose();

  await innerButton.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('combobox', { name: '语言 / Language', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '关闭任务详情', exact: true })).toBeFocused();
  await innerButton.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(attachments.getByRole('button', { name: '删除', exact: true })).toBeFocused();
  await innerButton.focus();
  await page.keyboard.press('Escape');
  await expectReleased();
  expect(graphReads).toBe(1);
  expect(detailReads).toBe(1);
  await trigger.click();
  await dialog.getByRole('tab', { name: '附件', exact: true }).click();
  await expect(attachments.getByRole('heading', { name: `附件 · ${seeds.length}`, exact: true })).toBeVisible();

  await selectFile(attachments, 'reports/brief.pdf');
  const pdfFrame = attachments.getByTitle('PDF 预览：reports/brief.pdf');
  await expect(pdfFrame).toBeVisible();
  await expect(pdfFrame).toHaveAttribute('src', attachmentPreviewUrl(project.id, task.id, 'reports/brief.pdf'));
  await paintedPdf(page, pdfFrame, info, pdf, new URL(attachmentPreviewUrl(project.id, task.id, 'reports/brief.pdf'), origin).href);
  await expectCenteredTaskDetail(page, dialog);
  await dialog.getByRole('button', { name: '关闭任务详情', exact: true }).click();
  await expectReleased();
  expect(graphReads).toBe(1);
  expect(detailReads).toBe(2);
  await trigger.click();
  await dialog.getByRole('tab', { name: '附件', exact: true }).click();
  await expect(attachments.getByRole('heading', { name: `附件 · ${seeds.length}`, exact: true })).toBeVisible();

  const uploadUrl = new URL(attachmentDownloadUrl(project.id, task.id, uploadedPath), origin).href;
  const upload = async (bytes: Buffer, expectedStatus: number): Promise<void> => {
    await attachments.getByLabel('选择一个文件').setInputFiles({ name: 'source.bin', mimeType: 'application/octet-stream', buffer: bytes });
    await expect(attachments.getByRole('textbox', { name: '目标相对路径' })).toHaveValue('source.bin');
    await attachments.getByRole('textbox', { name: '目标相对路径' }).fill(uploadedPath);
    const response = page.waitForResponse((response) => response.url() === uploadUrl && response.request().method() === 'PUT');
    await attachments.getByRole('button', { name: '上传文件', exact: true }).click();
    expect((await response).status()).toBe(expectedStatus);
    await expect(attachments.getByRole('heading', { name: uploadedPath, exact: true })).toBeVisible();
    await expect(attachments.getByRole('textbox', { name: '目标相对路径' })).toHaveValue('');
    expect(await cli.read(args('read', [uploadedPath]))).toEqual(bytes);
  };
  const firstUpload = Buffer.from([0, 255, 8, 13, 10, 0, 128, 61]);
  const overwritten = Buffer.from([254, 0, 2, 255, 128, 10, 13, 0, 42]);
  await upload(firstUpload, 201);
  await upload(overwritten, 200);
  const downloadEvent = page.waitForEvent('download');
  await attachments.getByRole('link', { name: '下载', exact: true }).click();
  const downloaded = await downloadEvent;
  const downloadPath = await downloaded.path();
  if (downloadPath === null) throw new Error('The UI attachment download did not produce an owned file.');
  expect(await readFile(downloadPath)).toEqual(overwritten);
  const deletion = page.waitForResponse((response) => response.url() === uploadUrl && response.request().method() === 'DELETE');
  await attachments.getByRole('button', { name: '删除', exact: true }).click();
  expect((await deletion).status()).toBe(204);
  await expect(attachments.getByRole('heading', { name: `附件 · ${seeds.length}`, exact: true })).toBeVisible();
  await expect(attachments.getByRole('region', { name: '附件预览', exact: true })).toHaveCount(0);
  const finalList = JSON.parse(await command(args('list', ['--json']))) as { path: string }[];
  expect(finalList.map(({ path }) => path)).toEqual(seeds.map(({ path }) => path).toSorted());
  const absent = await cli.run(args('read', [uploadedPath]));
  expect(absent.exitCode).not.toBe(0);
  expect(absent.stdout).toBe('');
  expect(absent.stderr).toMatch(/not found/i);
  const taskResponse = await request.get(`/api/v1/projects/${project.id}/tasks/${task.id}`);
  expect(taskResponse.status()).toBe(200);
  const finalTask = await taskResponse.json() as Task;
  expect(finalTask.version).toBe(task.version);
  expect(finalTask.updatedAt).toBe(task.updatedAt);
  expect(graphReads, 'Attachment writes do not refresh the task graph').toBe(1);
  expect(detailReads, 'Attachment writes do not refresh task details beyond the three deliberate opens').toBe(3);
  const screenshot = info.outputPath('task-attachments.png');
  await page.screenshot({ path: screenshot, fullPage: false });
  await info.attach('task-attachments', { path: screenshot, contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await expectReleased();
});
