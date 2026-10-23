import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect } from '@playwright/test';
import { command } from '../../scripts/acceptance/process.mts';
import { recordBrowserOwnership } from '../../scripts/acceptance/browser.mts';
import type { TaskProperties } from '../../src/api/types';
import { attachmentDownloadUrl } from '../../src/api/client';
import { bearerContext, browserAuthentication, type AuthenticatedAPI } from './authentication';

export { expect };
export type AttachmentWriteExpectation = {
  readonly origin: string;
  readonly method: 'PUT' | 'DELETE';
  readonly projectId: string;
  readonly taskId: string;
  readonly path: string;
  readonly count: number;
};
export type ApprovalWriteExpectation = {
  readonly action: 'approve' | 'unapprove';
  readonly origin: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly count: number;
};
type AttachmentWritePolicy = {
  readonly allowed: Map<string, { readonly count: number; observed: number }>;
  readonly approvals: Map<string, { readonly count: number; observed: number }>;
  readonly unexpected: string[];
  readonly register: (entries: readonly AttachmentWriteExpectation[]) => void;
  readonly registerApprovals: (entries: readonly ApprovalWriteExpectation[]) => void;
  readonly registerBrowser: (entries: readonly BrowserWriteExpectation[]) => void;
};
export type BrowserWriteExpectation = { readonly method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; readonly url: string; readonly count: number };
export const test = base.extend<{
  api: AuthenticatedAPI;
  authentication: 'automatic' | 'visible';
  authenticatedContext: void;
  acceptanceEvidence: void;
  allowAttachmentWrites: AttachmentWritePolicy['register'];
  allowApprovalWrites: AttachmentWritePolicy['registerApprovals'];
  attachmentWritePolicy: AttachmentWritePolicy;
  allowBrowserWrites: AttachmentWritePolicy['registerBrowser'];
}>({
  authentication: ['automatic', { option: true }],
  authenticatedContext: async ({ context, baseURL, authentication }, use) => {
    if (baseURL === undefined) throw new Error('Browser authentication requires the exact product origin.');
    if (authentication === 'automatic') await browserAuthentication(context, baseURL);
    await use();
  },
  page: async ({ page, authenticatedContext }, use) => { void authenticatedContext; await use(page); },
  api: async ({ playwright, baseURL }, use) => {
    if (baseURL === undefined) throw new Error('API fixture authentication requires the exact product origin.');
    const context = await bearerContext(playwright.request, baseURL);
    try { await use(context); } finally { await context.dispose(); }
  },
  attachmentWritePolicy: async ({}, use) => {
    const allowed: AttachmentWritePolicy['allowed'] = new Map();
    const approvals: AttachmentWritePolicy['approvals'] = new Map();
    const unexpected: string[] = [];
    const registerBrowser = (entries: readonly BrowserWriteExpectation[]) => {
      for (const entry of entries) {
        const url = new URL(entry.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.href !== entry.url || url.username !== '' || url.password !== '' || url.hash !== ''
          || !['POST', 'PATCH', 'PUT', 'DELETE'].includes(entry.method) || !Number.isInteger(entry.count) || entry.count < 1) throw new Error('Invalid exact browser write expectation.');
        const key = `${entry.method} ${url.href}`;
        if (allowed.has(key)) throw new Error('Duplicate exact browser write expectation.');
        allowed.set(key, { count: entry.count, observed: 0 });
      }
    };
    await use({ allowed, approvals, unexpected, registerBrowser, register: (entries) => {
      if (allowed.size !== 0) throw new Error('Attachment write expectations are registered once per scenario.');
      for (const entry of entries) {
        const origin = new URL(entry.origin);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== entry.origin
          || !['PUT', 'DELETE'].includes(entry.method) || !Number.isInteger(entry.count) || entry.count < 1) {
          throw new Error('Invalid exact attachment write expectation.');
        }
        const key = `${entry.method} ${new URL(attachmentDownloadUrl(entry.projectId, entry.taskId, entry.path), origin).href}`;
        if (allowed.has(key)) throw new Error('Duplicate exact attachment write expectation.');
        allowed.set(key, { count: entry.count, observed: 0 });
      }
    }, registerApprovals: (entries) => {
      if (approvals.size !== 0) throw new Error('Approval write expectations are registered once per scenario.');
      for (const entry of entries) {
        const origin = new URL(entry.origin);
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
        if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== entry.origin
          || !['approve', 'unapprove'].includes(entry.action) || !uuid.test(entry.projectId) || !uuid.test(entry.taskId) || !Number.isInteger(entry.count) || entry.count < 1) {
          throw new Error('Invalid exact approval write expectation.');
        }
        const key = `POST ${origin.origin}/api/v1/projects/${entry.projectId}/tasks/${entry.taskId}/${entry.action}`;
        if (approvals.has(key)) throw new Error('Duplicate exact approval write expectation.');
        approvals.set(key, { count: entry.count, observed: 0 });
      }
    } });
  },
  allowAttachmentWrites: async ({ attachmentWritePolicy }, use) => { await use(attachmentWritePolicy.register); },
  allowApprovalWrites: async ({ attachmentWritePolicy }, use) => { await use(attachmentWritePolicy.registerApprovals); },
  allowBrowserWrites: async ({ attachmentWritePolicy }, use) => { await use(attachmentWritePolicy.registerBrowser); },
  acceptanceEvidence: [async ({ browser, page, attachmentWritePolicy }, use) => {
    const directory = evidenceDirectory();
    await mkdir(directory, { recursive: true });
    const { identity, profile } = await recordBrowserOwnership(browser, directory);
    await writeFile(join(directory, 'browser.json'), `${JSON.stringify({
      name: browser.browserType().name(), version: browser.version(), platform: process.platform, arch: process.arch,
      node: process.version, ci: Boolean(process.env.CI), executableOverride: process.env.DAYNIGHT_BROWSER_EXECUTABLE !== undefined,
      identity, profile,
    }, null, 2)}\n`);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.name));
    page.on('request', (request) => {
      if (['GET', 'HEAD'].includes(request.method())) return;
      const key = `${request.method()} ${request.url()}`;
      const allowed = attachmentWritePolicy.allowed.get(key) ?? attachmentWritePolicy.approvals.get(key);
      if (allowed === undefined) attachmentWritePolicy.unexpected.push(key);
      else allowed.observed += 1;
    });
    await use();
    expect(pageErrors, 'Production page has no uncaught exceptions').toEqual([]);
    expect(attachmentWritePolicy.unexpected, 'Browser writes match only exact registered URLs and methods').toEqual([]);
    for (const [key, entry] of [...attachmentWritePolicy.allowed, ...attachmentWritePolicy.approvals]) {
      expect(entry.observed, `Exact browser write count: ${key}`).toBe(entry.count);
    }
  }, { auto: true }],
});
export type Project = { id: string; name: string; repoUrl: string; createdAt: string; updatedAt: string };
export type Task = {
  id: string; projectId: string; title: string; description: string; status: 'proposed' | 'todo' | 'in_progress' | 'done';
  version: number; dependsOn: string[]; blockedBy: string[]; ready: boolean; createdAt: string; updatedAt: string;
  properties: TaskProperties;
};

export const createProject = async (request: AuthenticatedAPI, input: { name?: string; repoUrl?: string } = {}): Promise<Project> => {
  const response = await request.post('/api/v1/projects', {
    data: { name: input.name ?? `Browser ${randomUUID()}`, repoUrl: input.repoUrl ?? 'https://github.com/example/browser-fixture' },
  });
  expect(response.status(), 'Project fixture creation succeeds').toBe(201);
  return await response.json() as Project;
};

export const createTask = async (request: AuthenticatedAPI, projectId: string, input: {
  title: string; description?: string; dependsOn?: string[]; properties?: TaskProperties;
}): Promise<Task> => {
  const response = await request.post(`/api/v1/projects/${projectId}/tasks`, {
    data: { title: input.title, description: input.description ?? '', dependsOn: input.dependsOn ?? [], properties: input.properties },
  });
  expect(response.status(), 'Task fixture creation succeeds').toBe(201);
  const task = await response.json() as Task;
  expect(task.status, 'Task fixture creation leaves approval pending').toBe('proposed');
  return task;
};

export const createProposedTask = createTask;

type TaskInput = Parameters<typeof createTask>[2];
type TaskVersion = Pick<Task, 'id' | 'version'>;
const transitionTask = async (request: AuthenticatedAPI, projectId: string, task: TaskVersion, action: 'approve' | 'claim' | 'complete'): Promise<Task> => {
  const response = await request.post(`/api/v1/projects/${projectId}/tasks/${task.id}/${action}`, { data: { version: task.version } });
  expect(response.status(), `Task fixture ${action} succeeds`).toBe(200);
  const result = await response.json() as Task;
  expect(result.status, `Task fixture ${action} reaches its forward state`).toBe({ approve: 'todo', claim: 'in_progress', complete: 'done' }[action]);
  expect(result.version, `Task fixture ${action} increments the observed version once`).toBe(task.version + 1);
  return result;
};
export const approveTask = async (request: AuthenticatedAPI, projectId: string, task: TaskVersion): Promise<Task> => transitionTask(request, projectId, task, 'approve');
export const claimTask = async (request: AuthenticatedAPI, projectId: string, task: TaskVersion): Promise<Task> => transitionTask(request, projectId, task, 'claim');
export const completeTask = async (request: AuthenticatedAPI, projectId: string, task: TaskVersion): Promise<Task> => transitionTask(request, projectId, task, 'complete');
export const createApprovedTask = async (request: AuthenticatedAPI, projectId: string, input: TaskInput): Promise<Task> =>
  approveTask(request, projectId, await createProposedTask(request, projectId, input));
export const completeApprovedTask = async (request: AuthenticatedAPI, projectId: string, task: TaskVersion): Promise<Task> =>
  completeTask(request, projectId, await claimTask(request, projectId, task));

export const updateTask = async (request: AuthenticatedAPI, projectId: string, taskId: string, input: {
  version: number; title?: string; description?: string; dependsOn?: string[]; properties?: TaskProperties;
}): Promise<Task> => {
  const response = await request.patch(`/api/v1/projects/${projectId}/tasks/${taskId}`, { data: input });
  expect(response.status(), 'Task fixture update succeeds').toBe(200);
  return await response.json() as Task;
};

export const evidenceDirectory = (): string => {
  const directory = process.env.DAYNIGHT_ACCEPTANCE_DIRECTORY;
  if (directory === undefined || !directory.startsWith('/')) throw new Error('Acceptance requires an absolute owned evidence directory.');
  return directory;
};

type DatabaseTarget = {
  postgresContainer: string; projectLabel: { key: string; value: string }; database: string;
};
const ownedDatabase = async (): Promise<DatabaseTarget> => {
  const target = JSON.parse(await readFile(join(evidenceDirectory(), 'target.json'), 'utf8')) as DatabaseTarget;
  if (!/^[a-zA-Z0-9_.-]+$/.test(target.postgresContainer) || target.database !== 'daynight'
    || !['com.docker.compose.project', 'io.daynight.acceptance.run'].includes(target.projectLabel.key)
    || !/^(daynight-dev-ci-|daynight-web-)[a-zA-Z0-9-]+$/.test(target.projectLabel.value)) {
    throw new Error('Refusing database control for an unowned target.');
  }
  const label = await command('docker', ['inspect', '--format', `{{index .Config.Labels "${target.projectLabel.key}"}}`, target.postgresContainer], {
    cwd: process.cwd(), timeoutMs: 10_000, quiet: true,
  });
  if (label !== target.projectLabel.value) throw new Error('Database ownership label differs from this acceptance target.');
  return target;
};

export const seedTaskVersion = async (projectId: string, taskId: string, version: bigint): Promise<void> => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!uuid.test(projectId) || !uuid.test(taskId) || version <= 0n || version >= 9223372036854775807n) {
    throw new Error('Invalid exact task version fixture.');
  }
  const target = await ownedDatabase();
  const result = await command('docker', ['exec', target.postgresContainer, 'psql', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1',
    '--username', 'daynight', '--dbname', target.database, '--tuples-only', '--no-align', '--command',
    `UPDATE tasks SET version = ${version} WHERE project_id = '${projectId}' AND id = '${taskId}' RETURNING version`], {
    cwd: process.cwd(), timeoutMs: 15_000, quiet: true,
  });
  expect(result.split('\n')[0], 'Owned task version fixture updates exactly the selected row').toBe(String(version));
};

export const seedClaimedTaskStart = async (projectId: string, taskId: string, ageMs: number | null): Promise<void> => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!uuid.test(projectId) || !uuid.test(taskId)
    || (ageMs !== null && (!Number.isSafeInteger(ageMs) || ageMs < 0))) throw new Error('Invalid owned claimed-task timing fixture.');
  const target = await ownedDatabase();
  const start = ageMs === null ? 'NULL' : `statement_timestamp() - ${ageMs} * interval '1ms'`;
  const result = await command('docker', ['exec', target.postgresContainer, 'psql', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1',
    '--username', 'daynight', '--dbname', target.database, '--tuples-only', '--no-align', '--command',
    `UPDATE tasks SET started_at = ${start} WHERE project_id = '${projectId}' AND id = '${taskId}' AND status = 'in_progress' AND completed_at IS NULL RETURNING id`], {
    cwd: process.cwd(), timeoutMs: 15_000, quiet: true,
  });
  expect(result.split('\n')[0], 'Owned timing fixture updates exactly the selected running task').toBe(taskId);
};

export const seedProjectSettingsVersion = async (projectId: string, version: bigint): Promise<void> => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(projectId)
    || version <= 0n || version >= 9223372036854775807n) throw new Error('Invalid exact project settings version fixture.');
  const target = await ownedDatabase();
  const result = await command('docker', ['exec', target.postgresContainer, 'psql', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1',
    '--username', 'daynight', '--dbname', target.database, '--tuples-only', '--no-align', '--command',
    `UPDATE projects SET settings_version = ${version} WHERE id = '${projectId}' RETURNING settings_version`], {
    cwd: process.cwd(), timeoutMs: 15_000, quiet: true,
  });
  expect(result.split('\n')[0], 'Owned settings version fixture updates exactly the selected project').toBe(String(version));
};

const withTableFailure = async <T>(table: 'task_dependencies' | 'projects', callback: () => Promise<T>): Promise<T> => {
  const target = await ownedDatabase();
  const sql = async (value: string): Promise<void> => {
    try {
      await command('docker', ['exec', target.postgresContainer, 'psql', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1',
        '--username', 'daynight', '--dbname', target.database, '--command', value], { cwd: process.cwd(), timeoutMs: 15_000, quiet: true });
    } catch (error) { throw new Error('Owned database failure control did not complete.', { cause: error }); }
  };
  const held = `acceptance_held_${table}`;
  await sql(`ALTER TABLE ${table} RENAME TO ${held}`);
  let original: unknown;
  try { return await callback(); }
  catch (error) { original = error; throw error; }
  finally {
    try { await sql(`ALTER TABLE ${held} RENAME TO ${table}`); }
    catch (error) {
      if (original !== undefined) throw new AggregateError([original, error], 'Browser scenario and database restoration failed.');
      throw error;
    }
  }
};

export const withDependencyFailure = async <T>(callback: () => Promise<T>): Promise<T> => withTableFailure('task_dependencies', callback);
export const withProjectsFailure = async <T>(callback: () => Promise<T>): Promise<T> => withTableFailure('projects', callback);
