import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { commandBytes } from './process.mts';
import { isGroupStopped, processIdentity, requireGroupStopped, sameProcess, type ProcessIdentity } from './identity.mts';

export type InstalledCliReceipt = {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly packageVersion: string;
  readonly tarballPath: string;
  readonly tarballSha256: string;
  readonly nodePath: string;
  readonly entryPath: string;
  readonly entrySha256: string;
  readonly launcherPath: string;
  readonly source: { readonly gitSha: string; readonly dirty: boolean };
};

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const acceptanceRoot = join(repositoryRoot, 'packages/daynight-web/.tmp/acceptance');
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const contained = (parent: string, child: string): boolean => child.startsWith(`${parent}${sep}`);
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
type Source = { gitSha: string; dirty: boolean; githubSha?: string | null };
type ParentEvidence = { runId: string; source: Source; installedCli?: { root: string; receiptPath?: string; receipt?: InstalledCliReceipt } };
type CliProcess = { directory: string; receiptPath: string; group: number; identity?: ProcessIdentity };

export const validateInstalledCli = async (receiptPath: string, directory: string): Promise<InstalledCliReceipt> => {
  if (!isAbsolute(receiptPath) || !isAbsolute(directory)) throw new Error('Installed CLI evidence paths must be absolute.');
  const expectedDirectory = resolve(directory);
  if (dirname(expectedDirectory) !== acceptanceRoot || !/^\d{14}-[a-f0-9-]{36}$/.test(basename(expectedDirectory))) throw new Error('Installed CLI is outside an owned acceptance run.');
  const receipt = await readJson(receiptPath) as InstalledCliReceipt;
  const evidence = await readJson(join(expectedDirectory, 'evidence.json')) as ParentEvidence;
  const recorded = evidence.installedCli;
  const recordedReceipt = recorded?.receipt;
  const fields = ['schemaVersion', 'root', 'packageVersion', 'tarballPath', 'tarballSha256', 'nodePath', 'entryPath', 'entrySha256', 'launcherPath'] as const;
  if (recorded === undefined || recordedReceipt === undefined || recorded.root !== receipt.root || recorded.receiptPath !== receiptPath || fields.some((field) => recordedReceipt[field] !== receipt[field])
    || recordedReceipt.source.gitSha !== receipt.source.gitSha || recordedReceipt.source.dirty !== receipt.source.dirty) throw new Error('Installed CLI receipt differs from its parent artifact evidence.');
  if (receipt.schemaVersion !== 1 || typeof receipt.root !== 'string' || !isAbsolute(receipt.root)
    || receipt.root !== join(expectedDirectory, 'installed-cli') || receiptPath !== join(receipt.root, 'installed-cli.json')
    || evidence.runId !== basename(expectedDirectory) || !/^[a-f0-9]{40}$/.test(evidence.source.gitSha)
    || typeof evidence.source.dirty !== 'boolean' || receipt.source.gitSha !== evidence.source.gitSha
    || receipt.source.dirty !== evidence.source.dirty) throw new Error('Installed CLI source or ownership differs from its acceptance run.');
  if (process.env.CI && (receipt.source.dirty || evidence.source.githubSha !== receipt.source.gitSha || process.env.GITHUB_SHA !== receipt.source.gitSha)) throw new Error('CI installed CLI evidence must match the clean GITHUB_SHA checkout.');
  const root = await realpath(receipt.root);
  if (root !== receipt.root || !contained(await realpath(expectedDirectory), root)) throw new Error('Installed CLI root resolves outside the acceptance run.');
  const entry = join(root, 'consumer install/node_modules/@codetreker/daynight/dist/main.js');
  const tarball = join(root, 'daynight.tgz');
  const launcher = join(root, 'consumer install/node_modules/.bin', process.platform === 'win32' ? 'daynight.cmd' : 'daynight');
  if (receipt.entryPath !== entry || receipt.tarballPath !== tarball || receipt.launcherPath !== launcher
    || !/^[a-f0-9]{64}$/.test(receipt.tarballSha256) || !/^[a-f0-9]{64}$/.test(receipt.entrySha256)
    || await realpath(receipt.nodePath) !== await realpath(process.execPath)) throw new Error('Installed CLI artifact paths or runtime differ.');
  for (const path of [receiptPath, entry, tarball, launcher]) if (!contained(root, await realpath(path))) throw new Error('Installed CLI artifact resolves outside its owned installation.');
  if (digest(await readFile(tarball)) !== receipt.tarballSha256 || digest(await readFile(entry)) !== receipt.entrySha256) throw new Error('Installed CLI artifact hash differs from its receipt.');
  const manifest = await readJson(join(dirname(dirname(entry)), 'package.json')) as { name: string; version: string; bin: { daynight: string } };
  const sourceManifest = await readJson(join(repositoryRoot, 'packages/daynight/package.json')) as { version: string };
  if (manifest.name !== '@codetreker/daynight' || manifest.version !== receipt.packageVersion || manifest.version !== sourceManifest.version
    || manifest.bin.daynight !== 'dist/main.js') throw new Error('Installed CLI package manifest differs from its source package.');
  return receipt;
};

export const recordCliProcess = (directory: string, receiptPath: string, child: ChildProcess): Promise<void> => {
  if (child.pid === undefined) throw new Error('Installed CLI process did not receive an operating-system identity.');
  const records = join(directory, 'cli-processes');
  mkdirSync(records, { recursive: true });
  const path = join(records, `${child.pid}-${randomUUID()}.json`);
  const record: CliProcess = { directory, receiptPath, group: child.pid };
  // Persist the detached group before an asynchronous identity read or command completion can intervene.
  writeFileSync(path, `${JSON.stringify(record)}\n`);
  return (async () => {
    const identity = await processIdentity(child.pid!);
    if (identity !== null) record.identity = identity;
    writeFileSync(`${path}.next`, `${JSON.stringify(record)}\n`);
    renameSync(`${path}.next`, path);
  })();
};

const ownedCliProcesses = async (directory: string, receipt: InstalledCliReceipt, receiptPath: string): Promise<ProcessIdentity[]> => {
  const result: ProcessIdentity[] = [];
  const node = await realpath(receipt.nodePath);
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name) || Number(name) <= 1) continue;
    try {
      const environment = (await readFile(`/proc/${name}/environ`)).toString().split('\0');
      if (!environment.includes(`DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT=${receiptPath}`)
        || !environment.includes(`DAYNIGHT_ACCEPTANCE_RUN_DIRECTORY=${directory}`)) continue;
      const identity = await processIdentity(Number(name));
      if (identity === null) continue;
      if (identity.executable !== node) throw new Error('An owned CLI process has an unexpected executable.');
      result.push(identity);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && ['ENOENT', 'ESRCH', 'EACCES'].includes(String(error.code)))) throw error;
    }
  }
  return result;
};

export const recoverCliProcesses = async (directory: string, receiptPath: string, receipt: InstalledCliReceipt): Promise<void> => {
  if (!isAbsolute(directory) || dirname(directory) !== acceptanceRoot || receipt.root !== join(directory, 'installed-cli')
    || receiptPath !== join(receipt.root, 'installed-cli.json') || !isAbsolute(receipt.nodePath)) throw new Error('Installed CLI recovery paths do not belong to this acceptance run.');
  const records: CliProcess[] = [];
  try {
    for (const name of await readdir(join(directory, 'cli-processes'))) {
      if (/^\d+-[a-f0-9-]{36}\.json\.next$/.test(name)) continue;
      if (!/^\d+-[a-f0-9-]{36}\.json$/.test(name)) throw new Error('Invalid installed CLI process receipt.');
      records.push(await readJson(join(directory, 'cli-processes', name)) as CliProcess);
    }
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const observed = await ownedCliProcesses(directory, receipt, receiptPath);
  const groups = new Set(records.map((record) => record.group));
  if (observed.some((identity) => !groups.has(identity.group))) throw new Error('An installed CLI process lacks its persisted group receipt.');
  for (const record of records) {
    if (record.directory !== directory || record.receiptPath !== receiptPath || !Number.isSafeInteger(record.group) || record.group <= 1
      || (record.identity !== undefined && (record.identity.pid !== record.group || record.identity.group !== record.group))) throw new Error('Installed CLI process receipt ownership differs.');
    const members = observed.filter((identity) => identity.group === record.group);
    if (members.length > 0) {
      if (record.identity !== undefined) {
        const leader = await processIdentity(record.identity.pid);
        if (leader !== null && !sameProcess(record.identity, leader)) throw new Error('Installed CLI group leader identity changed during recovery.');
      }
      for (const member of members) if (!sameProcess(member, await processIdentity(member.pid))) throw new Error('Installed CLI process changed before recovery.');
      process.kill(-record.group, 'SIGTERM');
      // Exited members can leave process discovery before their parents reap them and the group disappears.
      let remaining = members;
      for (let attempt = 0; attempt < 50; attempt++) {
        remaining = (await ownedCliProcesses(directory, receipt, receiptPath)).filter((identity) => identity.group === record.group);
        if (remaining.length === 0 && isGroupStopped(record.group)) break;
        await new Promise((done) => setTimeout(done, 100));
      }
      for (const member of remaining) {
        if (!sameProcess(member, await processIdentity(member.pid))) throw new Error('Installed CLI process changed before forced recovery.');
        process.kill(member.pid, 'SIGKILL');
      }
      for (let attempt = 0; attempt < 50; attempt++) {
        if (!(await ownedCliProcesses(directory, receipt, receiptPath)).some((identity) => identity.group === record.group) && isGroupStopped(record.group)) break;
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    requireGroupStopped(record.group);
  }
  if ((await ownedCliProcesses(directory, receipt, receiptPath)).length > 0) throw new Error('Installed CLI processes remain after recovery.');
};

export const createAcceptanceCli = async (baseURL: string, directory: string) => {
  const receiptPath = process.env.DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT;
  if (receiptPath === undefined || !isAbsolute(receiptPath)) throw new Error('Acceptance requires an absolute installed CLI receipt path.');
  const raw = await readJson(receiptPath) as InstalledCliReceipt;
  if (typeof raw.root !== 'string' || !isAbsolute(raw.root)) throw new Error('Invalid installed CLI root.');
  const runDirectory = dirname(raw.root);
  const receipt = await validateInstalledCli(receiptPath, runDirectory);
  const origin = new URL(baseURL);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== baseURL) throw new Error('Acceptance CLI server URL must be a service origin.');
  await mkdir(directory, { recursive: true });
  const working = await realpath(directory);
  if (!contained(runDirectory, working) || contained(receipt.root, working)) throw new Error('CLI workspace is outside its acceptance target.');
  const home = join(working, 'home');
  const cwd = join(working, 'workspace');
  await mkdir(join(home, '.daynight'), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(join(home, '.daynight/config.yml'), `serverUrl: ${JSON.stringify(baseURL)}\n`);
  const execute = async (args: readonly string[]) => {
    let group: number | undefined;
    let original: unknown;
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', HOME: home, USERPROFILE: home,
      DAYNIGHT_ACCEPTANCE_RUN_DIRECTORY: runDirectory, DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT: receiptPath };
    delete env.FORCE_COLOR;
    try {
      return await commandBytes(receipt.nodePath, [receipt.entryPath, ...args], {
        cwd, timeoutMs: 60_000,
        env,
        onSpawn: (child) => { group = child.pid; return recordCliProcess(runDirectory, receiptPath, child); },
      });
    } catch (cause) { original = cause; throw cause; }
    finally {
      if (group !== undefined) {
        try { requireGroupStopped(group); }
        catch (cleanup) { throw original === undefined ? cleanup : new AggregateError([original, cleanup], 'Installed CLI execution and process cleanup failed.'); }
      }
    }
  };
  return {
    run: async (args: readonly string[]) => {
      const result = await execute(args);
      return { exitCode: result.exitCode, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
    },
    read: async (args: readonly string[]): Promise<Buffer> => {
      const result = await execute(args);
      if (result.exitCode !== 0) throw new Error(`Installed CLI read failed (exit=${result.exitCode}): ${result.stderr.toString('utf8')}`);
      return result.stdout;
    },
  };
};
