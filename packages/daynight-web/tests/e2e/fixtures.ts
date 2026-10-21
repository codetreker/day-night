import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { command } from '../../scripts/acceptance/process.mts';
import { recordBrowserOwnership } from '../../scripts/acceptance/browser.mts';
import type { TaskProperties } from '../../src/api/types';

export { expect };
export const test = base.extend<{ acceptanceEvidence: void }>({
  acceptanceEvidence: [async ({ browser, page }, use) => {
    const directory = evidenceDirectory();
    await mkdir(directory, { recursive: true });
    const { identity, profile } = await recordBrowserOwnership(browser, directory);
    await writeFile(join(directory, 'browser.json'), `${JSON.stringify({
      name: browser.browserType().name(), version: browser.version(), platform: process.platform, arch: process.arch,
      node: process.version, ci: Boolean(process.env.CI), executableOverride: process.env.DAYNIGHT_BROWSER_EXECUTABLE !== undefined,
      identity, profile,
    }, null, 2)}\n`);
    const pageErrors: string[] = [];
    const writeMethods: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.name));
    page.on('request', (request) => { if (!['GET', 'HEAD'].includes(request.method())) writeMethods.push(request.method()); });
    await use();
    expect(pageErrors, 'Production page has no uncaught exceptions').toEqual([]);
    expect(writeMethods, 'Dashboard remains read-only').toEqual([]);
  }, { auto: true }],
});
export type Project = { id: string; name: string; repoUrl: string; createdAt: string; updatedAt: string };
export type Task = {
  id: string; projectId: string; title: string; description: string; status: 'todo' | 'in_progress' | 'done';
  version: number; dependsOn: string[]; blockedBy: string[]; ready: boolean; createdAt: string; updatedAt: string;
  properties: TaskProperties;
};

export const createProject = async (request: APIRequestContext, input: { name?: string; repoUrl?: string } = {}): Promise<Project> => {
  const response = await request.post('/api/v1/projects', {
    data: { name: input.name ?? `Browser ${randomUUID()}`, repoUrl: input.repoUrl ?? 'https://github.com/example/browser-fixture' },
  });
  expect(response.status(), 'Project fixture creation succeeds').toBe(201);
  return await response.json() as Project;
};

export const createTask = async (request: APIRequestContext, projectId: string, input: {
  title: string; description?: string; dependsOn?: string[]; properties?: TaskProperties;
}): Promise<Task> => {
  const response = await request.post(`/api/v1/projects/${projectId}/tasks`, {
    data: { title: input.title, description: input.description ?? '', dependsOn: input.dependsOn ?? [], properties: input.properties },
  });
  expect(response.status(), 'Task fixture creation succeeds').toBe(201);
  return await response.json() as Task;
};

export const updateTask = async (request: APIRequestContext, projectId: string, taskId: string, input: {
  version: number; title?: string; description?: string; status?: Task['status']; dependsOn?: string[]; properties?: TaskProperties;
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
