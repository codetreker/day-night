import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { command, type CommandOptions } from './process.mts';
import { aggregateScenarios, readReport, type Scenario } from './report.mts';
import { validatePerformance } from './performance.mts';
import { processIdentity, requireGroupStopped, requireStopped, sameProcess, type ProcessIdentity } from './identity.mts';
import { browserInventory, recoverBrowsers, type BrowserInventory } from './browser.mts';
import { waitForContainerPermission, writeContainerPermission } from './permission.mts';
import { runPipeline } from './pipeline.mts';
import { recoverCliProcesses, validateInstalledCli, type InstalledCliReceipt } from './installed-cli.mts';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const repositoryRoot = resolve(packageRoot, '../..');
const serverRoot = resolve(packageRoot, '../daynight-server');
const evidenceRoot = join(packageRoot, '.tmp/acceptance');
const script = fileURLToPath(new URL('../acceptance.mts', import.meta.url));
const labelKey = 'io.daynight.acceptance.run';
const functionalScenarios = ['project-list', 'project-graph', 'detail-navigation', 'refresh-staleness',
  'failure-recovery', 'deep-links', 'keyboard-focus', 'narrow-layout', 'task-attachments'] as const;
const capacityScenarios = ['capacity-chain', 'capacity-merge', 'capacity-shared', 'capacity-limits'] as const;

const json = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.next`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${path}.next`, path);
};
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
export type AcceptanceCommand = (file: string, args: readonly string[], options?: Omit<CommandOptions, 'cwd'> & { cwd?: string }) => Promise<string>;
export type AcceptancePreparations = { browser: (run: AcceptanceCommand) => Promise<void>; coverage: (run: AcceptanceCommand) => Promise<void> };

type InstalledPreparation = { receipt: InstalledCliReceipt; receiptPath: string; cleanup(): Promise<void> };
type InstalledFactoryOptions = { signal: AbortSignal; temporaryRoot: string; rootDirectory: string; onSpawn(child: ChildProcess): Promise<void> };
const prepareInstalledCli = async (options: InstalledFactoryOptions): Promise<InstalledPreparation> => {
  const fixture = await import(new URL('../../../daynight/test/fixtures/installed-cli.ts', import.meta.url).href) as Record<string, unknown>;
  if (typeof fixture.createInstalledCli !== 'function') throw new Error('The installed CLI preparation fixture is unavailable.');
  const create = fixture.createInstalledCli as (options: InstalledFactoryOptions) => Promise<InstalledPreparation>;
  return await create(options);
};

const createRunner = (cancellation: AbortController) => {
  const expectedServerShutdowns = new WeakSet<ChildProcess>();
  const run = (file: string, args: readonly string[], options: Omit<CommandOptions, 'cwd'> & { cwd?: string } = {}): Promise<string> =>
    command(file, args, { cwd: repositoryRoot, signal: cancellation.signal, ...options });

  type Source = { gitSha: string; githubSha: string | null; dirty: boolean };
  type TargetIdentity = {
    target: 'native' | 'container'; baseUrl: string; postgresContainer: string;
    projectLabel: { key: string; value: string }; database: 'daynight';
  };
  type BrowserPhase = TargetIdentity & {
    phase: 'functional' | 'capacity'; result: 'running' | 'passed' | 'failed'; startedAt: string; finishedAt?: string;
    browserCleanup: 'not-started' | 'pending' | 'passed' | 'failed'; scenarios?: Scenario[]; browser?: unknown; error?: string;
    playwrightProcess?: ProcessIdentity; playwrightGroup?: number; browserInventory?: BrowserInventory;
  };
  type Target = TargetIdentity & { result: 'running' | 'passed' | 'failed'; phases: BrowserPhase[]; scenarios?: Scenario[] };
  type Stage = {
    name: string; result: 'running' | 'passed' | 'failed'; startedAt: string; finishedAt?: string;
    commands: ProcessIdentity[]; commandGroups: number[]; error?: string;
  };
  type NativeEvidence = {
    owner: string; postgresContainer: string; postgresVolume: string; binary: string; storageRoot: string; binarySha256?: string;
    processPid?: number; postgresImage: string; postgresImageId?: string; postgresVersion?: string; cleanup: 'pending' | 'passed' | 'failed';
    processIdentity?: ProcessIdentity;
  };
  type InstalledEvidence = { root: string; receiptPath?: string; receipt?: InstalledCliReceipt; cleanup: 'pending' | 'passed' | 'failed' };
  type ReadyInstalledEvidence = InstalledEvidence & { receiptPath: string; receipt: InstalledCliReceipt };
  const readyInstallation = (installed: InstalledEvidence | undefined): ReadyInstalledEvidence => {
    if (installed?.receiptPath === undefined || installed.receipt === undefined) throw new Error('The shared installed CLI is not prepared.');
    return { ...installed, receiptPath: installed.receiptPath, receipt: installed.receipt };
  };
  type Evidence = {
    schemaVersion: 2; runId: string; source: Source; startedAt: string; result: 'running' | 'passed' | 'failed';
    native: NativeEvidence; targets: Target[]; stages: Stage[]; container?: unknown; performance?: unknown;
    cleanup: 'pending' | 'passed' | 'failed'; finishedAt?: string; error?: string; cleanupErrors?: string[];
    installedCli?: InstalledEvidence;
    runner: ProcessIdentity; devCi?: { runId?: string; runner?: ProcessIdentity };
  };

  const sourceIdentity = async (): Promise<Source> => {
    const gitSha = await run('git', ['rev-parse', 'HEAD'], { quiet: true });
    const dirty = (await run('git', ['status', '--porcelain', '--untracked-files=normal'], { quiet: true })) !== '';
    const githubSha = process.env.GITHUB_SHA ?? null;
    if (!/^[a-f0-9]{40}$/.test(gitSha)) throw new Error('Invalid source revision.');
    if (process.env.CI && (dirty || githubSha !== gitSha)) throw new Error('CI acceptance requires a clean checkout at GITHUB_SHA.');
    return { gitSha, githubSha, dirty };
  };

  const playwright = async (target: BrowserPhase, directory: string, installed: ReadyInstalledEvidence): Promise<BrowserPhase> => {
    let identitySaved: Promise<void> = Promise.resolve();
    let failure: unknown;
    try {
      target.browserInventory = await browserInventory();
      target.browserCleanup = 'pending';
      await json(join(directory, 'target.json'), target);
      await mkdir(join(packageRoot, '.tmp'), { recursive: true });
      await run('pnpm', ['exec', 'playwright', 'test', '--workers=1', '--retries=0', '--reporter=line,json',
        target.phase === 'capacity' ? '--grep' : '--grep-invert', '@capacity'], {
        cwd: packageRoot, timeoutMs: 900_000,
        env: { ...process.env, TMPDIR: '.tmp', DAYNIGHT_BASE_URL: target.baseUrl, DAYNIGHT_ACCEPTANCE_TARGET: target.target,
          DAYNIGHT_ACCEPTANCE_DIRECTORY: directory, DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT: installed.receiptPath, PLAYWRIGHT_JSON_OUTPUT_FILE: join(directory, 'playwright.json') },
        onSpawn: (child) => {
          target.playwrightGroup = child.pid!;
          identitySaved = (async () => {
            const identity = await processIdentity(child.pid!);
            if (identity !== null) target.playwrightProcess = identity;
            await json(join(directory, 'target.json'), target);
          })();
          void identitySaved.catch(() => {});
        },
      });
      await identitySaved;
      target.scenarios = readReport(await readJson(join(directory, 'playwright.json')),
        target.phase === 'capacity' ? capacityScenarios : functionalScenarios);
      for (const scenario of target.scenarios) {
        for (const path of scenario.screenshots) {
          if (!resolve(path).startsWith(`${resolve(directory)}${sep}`)) throw new Error('Screenshot lies outside the owned acceptance directory.');
          const screenshot = await readFile(path);
          if (!screenshot.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid screenshot evidence.');
        }
      }
      const browser = await readJson(join(directory, 'browser.json')) as Record<string, unknown>;
      if (browser.name !== 'chromium' || typeof browser.version !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(browser.version)
        || (process.env.CI && (browser.platform !== 'linux' || browser.executableOverride !== false))) {
        throw new Error('Invalid browser identity for production acceptance.');
      }
      if (process.env.CI) {
        const testRequire = createRequire(import.meta.resolve('@playwright/test'));
        const playwrightRequire = createRequire(testRequire.resolve('playwright'));
        const corePackage = playwrightRequire.resolve('playwright-core/package.json');
        const registry = await readJson(join(dirname(corePackage), 'browsers.json')) as { browsers: { name: string; browserVersion?: string }[] };
        const bundled = registry.browsers.find((candidate) => candidate.name === 'chromium');
        if (bundled === undefined || bundled.browserVersion !== browser.version) throw new Error('CI must use the pinned Playwright Chromium version.');
      }
      target.browser = browser;
    } catch (error) { failure = error; }
    finally {
      const failures: unknown[] = failure === undefined ? [] : [failure];
      try { await identitySaved; } catch (error) { if (!failures.includes(error)) failures.push(error); }
      if (target.playwrightGroup !== undefined) {
        try { requireGroupStopped(target.playwrightGroup); } catch (error) { failures.push(error); }
      }
      try { await recoverCliProcesses(dirname(installed.receipt.root), installed.receiptPath, installed.receipt); }
      catch (error) { failures.push(error); }
      if (target.browserInventory !== undefined) {
        try { await recoverBrowsers(directory, target.browserInventory); target.browserCleanup = 'passed'; }
        catch (error) { target.browserCleanup = 'failed'; failures.push(error); }
      }
      target.finishedAt = new Date().toISOString();
      target.result = failures.length === 0 ? 'passed' : 'failed';
      if (failures.length > 0) target.error = failures.map((error) => error instanceof Error ? error.message : String(error)).join('; ');
      try { await json(join(directory, 'target.json'), target); } catch (error) { failures.push(error); }
      if (failures.length > 0) throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'Browser phase or cleanup failed.');
    }
    return target;
  };

  const containerCallback = async (): Promise<void> => {
    const directory = process.env.DAYNIGHT_ACCEPTANCE_DIRECTORY;
    const runId = process.env.DAYNIGHT_DEV_CI_RUN_ID;
    const baseUrl = process.env.DAYNIGHT_BASE_URL;
    if (directory === undefined || !directory.startsWith(`${evidenceRoot}/`) || runId === undefined
      || !/^\d{14}-\d+-\d{5}$/.test(runId) || baseUrl === undefined || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) {
      throw new Error('Invalid owned container acceptance invocation.');
    }
    const acceptanceDirectory = dirname(directory);
    const evidence = await readJson(join(acceptanceDirectory, 'evidence.json')) as Evidence;
    if (evidence.schemaVersion !== 2 || directory !== join(evidenceRoot, evidence.runId, 'container')
      || !/^\d{14}-[a-f0-9-]{36}$/.test(evidence.runId) || !/^[a-f0-9]{40}$/.test(evidence.source.gitSha)) {
      throw new Error('Container callback does not belong to this acceptance source and run.');
    }
    const project = `daynight-dev-ci-${runId}`;
    const callback = await processIdentity(process.pid);
    if (callback === null) throw new Error('Container callback process identity disappeared.');
    await json(join(directory, 'callback.json'), callback);
    await json(join(directory, 'dev-ci-run.json'), { runId });
    const postgresContainer = await run('docker', ['ps', '--quiet', '--no-trunc', '--filter', `label=com.docker.compose.project=${project}`,
      '--filter', 'label=com.docker.compose.service=postgres'], { quiet: true, timeoutMs: 10_000 });
    if (!/^[a-f0-9]{64}$/.test(postgresContainer)) throw new Error('Dev-ci PostgreSQL container was not uniquely identified.');
    await json(join(directory, 'ready.json'), { acceptanceRunId: evidence.runId, devCiRunId: runId,
      sourceGitSha: evidence.source.gitSha, callback, readyAt: new Date().toISOString() });
    await waitForContainerPermission(directory, { acceptanceRunId: evidence.runId, devCiRunId: runId,
      sourceGitSha: evidence.source.gitSha }, { signal: cancellation.signal, timeoutMs: 900_000 });
    cancellation.signal.throwIfAborted();
    const prepared = await readJson(join(acceptanceDirectory, 'evidence.json')) as Evidence;
    const installation = readyInstallation(prepared.installedCli);
    await validateInstalledCli(installation.receiptPath, acceptanceDirectory);
    await playwright({ target: 'container', phase: 'functional', result: 'running', startedAt: new Date().toISOString(),
      browserCleanup: 'not-started', baseUrl, postgresContainer,
      projectLabel: { key: 'com.docker.compose.project', value: project }, database: 'daynight' }, directory, installation);
  };

  const wait = async (milliseconds: number): Promise<void> => {
    cancellation.signal.throwIfAborted();
    await new Promise<void>((resolveWait, reject) => {
      const timer = setTimeout(() => { cancellation.signal.removeEventListener('abort', abort); resolveWait(); }, milliseconds);
      const abort = (): void => { clearTimeout(timer); reject(new Error('Acceptance cancelled.')); };
      cancellation.signal.addEventListener('abort', abort, { once: true });
    });
  };

  const startServer = async (binary: string, databaseUrl: string, evidence: NativeEvidence, register: (child: ChildProcess) => void,
    persist: () => Promise<void>): Promise<{ child: ChildProcess; baseUrl: string }> => {
    cancellation.signal.throwIfAborted();
    await mkdir(evidence.storageRoot, { recursive: true });
    const child = spawn(binary, [], { cwd: serverRoot, env: { ...process.env, DAYNIGHT_DATABASE_URL: databaseUrl,
      DAYNIGHT_LISTEN_ADDR: '127.0.0.1:0', DAYNIGHT_STORAGE_ROOT: evidence.storageRoot },
      stdio: ['ignore', 'ignore', 'pipe'] });
    register(child);
    if (child.pid !== undefined) evidence.processPid = child.pid;
    const identityReady = new Promise<void>((resolveIdentity, rejectIdentity) => {
      child.once('spawn', () => {
        void processIdentity(child.pid!).then((identity) => {
          if (identity === null || identity.executable !== binary) throw new Error('Native Go executable identity differs from the owned binary.');
          evidence.processIdentity = identity;
        }).then(persist).then(resolveIdentity, rejectIdentity);
      });
      child.once('error', rejectIdentity);
    });
    void identityReady.catch(() => {});
    return await new Promise((resolveReady, reject) => {
      let partial = '';
      let ready = false;
      const timer = setTimeout(() => reject(new Error('Native Go readiness timed out.')), 45_000);
      const abort = (): void => { clearTimeout(timer); reject(new Error('Native Go startup cancelled.')); };
      cancellation.signal.addEventListener('abort', abort, { once: true });
      const finish = (): void => { clearTimeout(timer); cancellation.signal.removeEventListener('abort', abort); };
      child.once('error', (error) => { finish(); reject(error); });
      child.once('exit', (code, signal) => {
        finish();
        if (!ready) reject(new Error('Native Go process exited before readiness.'));
        else if (!expectedServerShutdowns.has(child)) {
          cancellation.abort(new Error(`Native Go exited unexpectedly (exit=${code}, signal=${signal}).`));
        }
      });
      child.stderr!.on('data', (data: Buffer) => {
        partial += data.toString('utf8');
        if (partial.length > 65_536) { finish(); reject(new Error('Native Go emitted an oversized structured log line.')); return; }
        let boundary: number;
        while ((boundary = partial.indexOf('\n')) !== -1) {
          const line = partial.slice(0, boundary); partial = partial.slice(boundary + 1);
          let record: { phase?: unknown; address?: unknown };
          try {
            const decoded: unknown = JSON.parse(line);
            if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Invalid structured log.');
            record = decoded as typeof record;
          }
          catch { finish(); reject(new Error('Native Go emitted invalid structured logs.')); return; }
          if (record.phase === 'listening' && typeof record.address === 'string' && /^127\.0\.0\.1:[1-9]\d*$/.test(record.address)) {
            ready = true; finish();
            void identityReady.then(() => resolveReady({ child, baseUrl: `http://${record.address}` }), reject);
          }
        }
      });
    });
  };

  const stopServer = async (child: ChildProcess | undefined): Promise<void> => {
    if (child === undefined) return;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Native Go exited before the requested shutdown.');
    expectedServerShutdowns.add(child);
    const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
    child.kill('SIGTERM');
    let timer: NodeJS.Timeout | undefined;
    const graceful = await Promise.race([exited.then(() => true), new Promise<boolean>((resolveWait) => { timer = setTimeout(() => resolveWait(false), 20_000); })]);
    clearTimeout(timer);
    if (!graceful) {
      child.kill('SIGKILL');
      await Promise.race([exited, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Owned native Go process did not exit.')), 5_000); })]);
      clearTimeout(timer);
      throw new Error('Native Go required forced shutdown.');
    }
    if (child.exitCode !== 0) throw new Error('Native Go did not shut down successfully.');
  };

  const cleanupNative = async (native: NativeEvidence): Promise<void> => {
    const options = { cwd: repositoryRoot, quiet: true, timeoutMs: 20_000 };
    const containers = await command('docker', ['ps', '--all', '--quiet', '--filter', `label=${labelKey}=${native.owner}`], options);
    for (const id of containers.split('\n').filter(Boolean)) {
      if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Invalid owned container identity.');
      const identity = await command('docker', ['inspect', '--format', `{{.Name}}|{{index .Config.Labels "${labelKey}"}}`, id], options);
      if (identity !== `/${native.postgresContainer}|${native.owner}`) throw new Error('Native container ownership differs from its receipt.');
      await command('docker', ['rm', '--force', '--volumes', id], options);
    }
    const volumes = await command('docker', ['volume', 'ls', '--quiet', '--filter', `label=${labelKey}=${native.owner}`], options);
    for (const name of volumes.split('\n').filter(Boolean)) {
      if (name !== native.postgresVolume) throw new Error('Unexpected volume with native ownership label.');
      const owner = await command('docker', ['volume', 'inspect', '--format', `{{index .Labels "${labelKey}"}}`, name], options);
      if (owner !== native.owner) throw new Error('Native volume ownership differs from its receipt.');
      await command('docker', ['volume', 'rm', name], options);
    }
    const remaining = await command('docker', ['ps', '--all', '--quiet', '--filter', `label=${labelKey}=${native.owner}`], options);
    const remainingVolumes = await command('docker', ['volume', 'ls', '--quiet', '--filter', `label=${labelKey}=${native.owner}`], options);
    if (remaining !== '' || remainingVolumes !== '') throw new Error('Native acceptance resources remain.');
  };

  const cleanupNativeStorage = async (native: NativeEvidence, runId: string): Promise<void> => {
    const storageRoot = join(evidenceRoot, runId, 'native-storage');
    if (!/^\d{14}-[a-f0-9-]{36}$/.test(runId) || native.storageRoot !== storageRoot
      || native.binary !== join(evidenceRoot, runId, 'daynight-server')) {
      throw new Error('Native storage ownership differs from its receipt.');
    }
    if (native.processIdentity !== undefined) await requireStopped(native.processIdentity);
    else if (native.processPid !== undefined && await processIdentity(native.processPid) !== null) {
      throw new Error('Native process lacks enough identity evidence for storage cleanup.');
    }
    await rm(storageRoot, { recursive: true, force: true });
  };

  const validIdentity = (value: unknown): ProcessIdentity => {
    if (value === null || typeof value !== 'object') throw new Error('Missing recorded process identity.');
    const identity = value as ProcessIdentity;
    if (!Number.isSafeInteger(identity.pid) || identity.pid <= 1 || typeof identity.executable !== 'string'
      || !identity.executable.startsWith('/') || typeof identity.startTicks !== 'string' || !/^\d+$/.test(identity.startTicks)
      || !Number.isSafeInteger(identity.group) || identity.group <= 0) {
      throw new Error('Invalid recorded process identity.');
    }
    return identity;
  };

  const optionalJson = async (path: string): Promise<unknown | undefined> => {
    try { return await readJson(path); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  };

  const cleanupInstallation = async (evidence: Evidence, directory: string, persist: () => Promise<void>): Promise<void> => {
    const installed = evidence.installedCli;
    if (installed === undefined) return;
    if (installed.root !== join(directory, 'installed-cli')
      || (installed.receiptPath === undefined) !== (installed.receipt === undefined)) throw new Error('Installed CLI preparation ownership differs from this run.');
    for (const stage of evidence.stages) {
      for (const identity of stage.commands) await requireStopped(validIdentity(identity));
      for (const group of stage.commandGroups) requireGroupStopped(group);
    }
    if (installed.receipt !== undefined && installed.receiptPath !== undefined) {
      if (installed.receipt.root !== installed.root || installed.receipt.source.gitSha !== evidence.source.gitSha
        || installed.receipt.source.dirty !== evidence.source.dirty) throw new Error('Installed CLI artifact source differs from its owner.');
      const present = await optionalJson(installed.receiptPath);
      if (present !== undefined) await validateInstalledCli(installed.receiptPath, directory);
      else if (installed.cleanup !== 'passed') throw new Error('Installed CLI artifacts disappeared before confirmed cleanup.');
      await recoverCliProcesses(directory, installed.receiptPath, installed.receipt);
    }
    await rm(installed.root, { recursive: true, force: true });
    installed.cleanup = 'passed';
    await persist();
  };

  const recover = async (requestedRunId: string | undefined): Promise<void> => {
    if (requestedRunId !== undefined && !/^\d{14}-[a-f0-9-]{36}$/.test(requestedRunId)) throw new Error('Invalid acceptance recovery run ID.');
    const original = await optionalJson(requestedRunId === undefined ? join(evidenceRoot, 'evidence.json') : join(evidenceRoot, requestedRunId, 'evidence.json'));
    if (original === undefined) { console.log('Web acceptance recovery: no run receipt; no resources were changed.'); return; }
    const evidence = original as Evidence;
    if (evidence.schemaVersion !== 2 || !/^\d{14}-[a-f0-9-]{36}$/.test(evidence.runId)
      || (requestedRunId !== undefined && evidence.runId !== requestedRunId)) throw new Error('Invalid acceptance recovery receipt.');
    const directory = join(evidenceRoot, evidence.runId);
    const owner = `daynight-web-${evidence.runId}`;
    const native = evidence.native;
    if (native.owner !== owner || native.postgresContainer !== `${owner}-postgres` || native.postgresVolume !== `${owner}-data`
      || native.binary !== join(directory, 'daynight-server') || native.storageRoot !== join(directory, 'native-storage')
      || !/^[a-f0-9]{40}$/.test(evidence.source.gitSha)
      || (process.env.GITHUB_SHA !== undefined && evidence.source.githubSha !== process.env.GITHUB_SHA)) {
      throw new Error('Recovery receipt does not identify this run resources and source.');
    }
    const receipt: Record<string, unknown> = { schemaVersion: 2, runId: evidence.runId, result: 'running', startedAt: new Date().toISOString() };
    const save = async (): Promise<void> => {
      await json(join(directory, 'recovery.json'), receipt);
      await json(join(evidenceRoot, 'recovery.json'), receipt);
    };
    await save();
    try {
      await requireStopped(validIdentity(evidence.runner));
      if (!Array.isArray(evidence.stages)) throw new Error('Recovery receipt is missing its pipeline stages.');
      for (const stage of evidence.stages) {
        if (!Array.isArray(stage.commands) || !Array.isArray(stage.commandGroups)) throw new Error('Invalid pipeline command ownership.');
        for (const identity of stage.commands) await requireStopped(validIdentity(identity));
        for (const group of stage.commandGroups) {
          if (!Number.isSafeInteger(group) || group <= 1) throw new Error('Invalid pipeline command group.');
          requireGroupStopped(group);
        }
      }
      if (evidence.devCi?.runner !== undefined) {
        const identity = validIdentity(evidence.devCi.runner);
        await requireStopped(identity); requireGroupStopped(identity.pid);
      }
      const callback = await optionalJson(join(directory, 'container/callback.json'));
      if (callback !== undefined) {
        const identity = validIdentity(callback);
        await requireStopped(identity); requireGroupStopped(identity.pid);
      }
      for (const targetName of ['native/capacity', 'container', 'native/functional']) {
        const targetDirectory = join(directory, targetName);
        const target = await optionalJson(join(targetDirectory, 'target.json')) as BrowserPhase | undefined;
        if (target?.playwrightProcess !== undefined) {
          const identity = validIdentity(target.playwrightProcess);
          await requireStopped(identity); requireGroupStopped(identity.pid);
        }
        if (target?.playwrightGroup !== undefined) requireGroupStopped(target.playwrightGroup);
        if (target?.browserInventory !== undefined) await recoverBrowsers(targetDirectory, target.browserInventory);
      }
      if (evidence.installedCli !== undefined) {
        await cleanupInstallation(evidence, directory, async () => {
          await json(join(directory, 'evidence.json'), evidence);
          const latest = await optionalJson(join(evidenceRoot, 'evidence.json')) as Evidence | undefined;
          if (latest?.runId === evidence.runId) await json(join(evidenceRoot, 'evidence.json'), evidence);
        });
        receipt.installedCli = 'passed';
      }
      if (native.processIdentity !== undefined) {
        const identity = validIdentity(native.processIdentity);
        if (identity.pid !== native.processPid || identity.executable !== native.binary) throw new Error('Native process receipt does not match its binary.');
        const observed = await processIdentity(identity.pid);
        if (observed !== null && observed.startTicks === identity.startTicks && !sameProcess(identity, observed)) throw new Error('Native executable identity changed before recovery.');
        if (sameProcess(identity, observed)) {
          if (native.binarySha256 === undefined || !/^[a-f0-9]{64}$/.test(native.binarySha256)
            || createHash('sha256').update(await readFile(native.binary)).digest('hex') !== native.binarySha256) {
            throw new Error('Native recovery executable hash differs from the built artifact.');
          }
          if (!sameProcess(identity, await processIdentity(identity.pid))) throw new Error('Native process changed during recovery verification.');
          process.kill(identity.pid, 'SIGTERM');
          let deadline = Date.now() + 20_000;
          while (sameProcess(identity, await processIdentity(identity.pid)) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
          if (sameProcess(identity, await processIdentity(identity.pid))) {
            process.kill(identity.pid, 'SIGKILL');
            receipt.nativeForced = true;
            deadline = Date.now() + 5_000;
            while (sameProcess(identity, await processIdentity(identity.pid)) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
          }
          if (sameProcess(identity, await processIdentity(identity.pid))) throw new Error('Verified native process remains after bounded recovery.');
          receipt.nativeProcess = 'stopped';
        } else receipt.nativeProcess = 'absent';
      } else {
        if (native.processPid !== undefined && await processIdentity(native.processPid) !== null) throw new Error('Native process lacks enough identity evidence for recovery.');
        receipt.nativeProcess = 'not-started';
      }
      await cleanupNative(native);
      receipt.nativeDocker = 'passed';
      await cleanupNativeStorage(native, evidence.runId);
      receipt.nativeStorage = 'passed';
      if (evidence.devCi?.runId !== undefined) {
        const runId = evidence.devCi.runId;
        if (!/^\d{14}-\d+-\d{5}$/.test(runId)) throw new Error('Invalid recorded dev-ci recovery run ID.');
        const manifest = await readJson(join(repositoryRoot, '.tmp/dev-ci', runId, 'manifest.json')) as Record<string, unknown>;
        if (manifest.runId !== runId || manifest.project !== `daynight-dev-ci-${runId}`) throw new Error('Dev-ci recovery receipt ownership differs.');
        await command('bash', ['deployment/dev-ci/run.sh', '--cleanup', runId], { cwd: repositoryRoot, timeoutMs: 180_000 });
        const recovered = await readJson(join(repositoryRoot, '.tmp/dev-ci', runId, 'recovery-manifest.json')) as Record<string, unknown>;
        if (recovered.cleanupResult !== 'passed') throw new Error('Dev-ci targeted recovery did not pass.');
        receipt.devCi = recovered;
      }
      receipt.result = 'passed';
    } catch (error) {
      receipt.result = 'failed'; receipt.error = error instanceof Error ? error.message : 'Owned-resource recovery failed.';
      throw error;
    } finally { receipt.finishedAt = new Date().toISOString(); await save(); }
    console.log(`Web acceptance recovery ${evidence.runId}: passed.`);
  };

  const main = async (preparations?: AcceptancePreparations): Promise<void> => {
    const compose = await readFile(join(repositoryRoot, 'deployment/dev-ci/compose.yaml'), 'utf8');
    const images = [...compose.matchAll(/^\s+image:\s+(postgres:18\.6-bookworm@sha256:[a-f0-9]{64})\s*$/gm)];
    if (images.length !== 1) throw new Error('Dev-ci must declare exactly one pinned PostgreSQL 18.6 image.');
    const postgresImage = images[0]![1]!;
    const runId = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID()}`;
    const directory = join(evidenceRoot, runId);
    const containerDirectory = join(directory, 'container');
    const owner = `daynight-web-${runId}`;
    const runner = await processIdentity(process.pid);
    if (runner === null) throw new Error('Acceptance runner process identity disappeared.');
    const evidence: Evidence = { schemaVersion: 2, runId, source: await sourceIdentity(), startedAt: new Date().toISOString(),
      result: 'running', native: { owner, postgresContainer: `${owner}-postgres`, postgresVolume: `${owner}-data`,
        binary: join(directory, 'daynight-server'), storageRoot: join(directory, 'native-storage'),
        postgresImage, cleanup: 'pending' }, targets: [], stages: [], cleanup: 'pending', runner };
    let evidenceWrites = Promise.resolve();
    const save = (): Promise<void> => {
      evidenceWrites = evidenceWrites.then(async () => {
        await json(join(directory, 'evidence.json'), evidence);
        await json(join(evidenceRoot, 'evidence.json'), evidence);
      });
      return evidenceWrites;
    };
    const stage = async (name: string, operation: (ownedRun: AcceptanceCommand, register: (child: ChildProcess) => Promise<void>) => Promise<void>): Promise<void> => {
      const current: Stage = { name, result: 'running', startedAt: new Date().toISOString(), commands: [], commandGroups: [] };
      evidence.stages.push(current);
      await save();
      const register = async (child: ChildProcess): Promise<void> => {
        current.commandGroups.push(child.pid!);
        const identity = await processIdentity(child.pid!);
        if (identity !== null) current.commands.push(identity);
        await save();
      };
      const ownedRun: AcceptanceCommand = async (file, args, options = {}) => {
        let identitySaved = Promise.resolve();
        let failure: unknown;
        let group: number | undefined;
        let output = '';
        try {
          output = await run(file, args, { ...options, onSpawn: (child) => {
            group = child.pid!;
            identitySaved = Promise.all([register(child), options.onSpawn?.(child)]).then(() => {});
            return identitySaved;
          } });
        } catch (error) { failure = error; }
        try { await identitySaved; }
        catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], 'Command and identity recording failed.'); }
        if (group !== undefined) {
          try { requireGroupStopped(group); }
          catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], 'Command and process group cleanup failed.'); }
        }
        if (failure !== undefined) throw failure;
        return output;
      };
      let failure: unknown;
      try { await operation(ownedRun, register); }
      catch (error) { failure = error; current.error = error instanceof Error ? error.message : String(error); }
      current.result = failure === undefined ? 'passed' : 'failed';
      current.finishedAt = new Date().toISOString();
      try { await save(); }
      catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], 'Stage and evidence recording failed.'); }
      if (failure !== undefined) throw failure;
    };
    const installedEvidence = (): ReadyInstalledEvidence => readyInstallation(evidence.installedCli);
    let child: ChildProcess | undefined;
    let nativeTarget: Target | undefined;
    let devCiRunId: string | undefined;
    let failure: unknown;
    const native = (): Target => {
      if (nativeTarget === undefined) throw new Error('Native target is not prepared.');
      return nativeTarget;
    };
    const nativePhase = (phase: 'functional' | 'capacity'): BrowserPhase => {
      const target = native();
      const result: BrowserPhase = { target: 'native', baseUrl: target.baseUrl, postgresContainer: target.postgresContainer,
        projectLabel: target.projectLabel, database: target.database, phase, result: 'running',
        startedAt: new Date().toISOString(), browserCleanup: 'not-started' };
      target.phases.push(result);
      return result;
    };
    const aggregate = (target: Target, required: readonly string[]): void => {
      target.scenarios = aggregateScenarios(target.phases.map((phase) => {
        if (phase.result !== 'passed' || phase.browserCleanup !== 'passed' || phase.scenarios === undefined) {
          throw new Error('Target contains an incomplete browser phase.');
        }
        return phase.scenarios;
      }), required);
      const browsers = [...evidence.targets.filter((other) => other !== target).flatMap((other) => other.phases), ...target.phases]
        .map((phase) => phase.browser as Record<string, unknown>);
      const identity = (browser: Record<string, unknown>) => JSON.stringify([
        browser.name, browser.version, browser.platform, browser.executableOverride,
      ]);
      if (browsers.some((browser) => identity(browser) !== identity(browsers[0]!))) throw new Error('Browser identity changed between acceptance targets or phases.');
      target.result = 'passed';
    };
    await save();
    try {
      await runPipeline(cancellation, {
        browser: () => stage('browser-preparation', async (ownedRun) => { if (preparations !== undefined) await preparations.browser(ownedRun); }),
        coverage: () => stage('coverage', async (ownedRun) => { if (preparations !== undefined) await preparations.coverage(ownedRun); }),
        nativePreparation: () => stage('native-preparation', async (ownedRun, register) => {
          console.log(`Web acceptance ${runId}: building production assets and native Go executable.`);
          await ownedRun('pnpm', ['build'], { timeoutMs: 180_000 });
          evidence.installedCli = { root: join(directory, 'installed-cli'), cleanup: 'pending' };
          await save();
          const installed = await prepareInstalledCli({ signal: cancellation.signal, temporaryRoot: directory,
            rootDirectory: evidence.installedCli.root, onSpawn: register });
          evidence.installedCli.receiptPath = installed.receiptPath;
          evidence.installedCli.receipt = installed.receipt;
          await save();
          await validateInstalledCli(installed.receiptPath, directory);
          await ownedRun('pnpm', ['web:build'], { timeoutMs: 180_000 });
          await ownedRun('bash', ['-c', 'source scripts/env.sh\ngo build -o "$1" ./cmd/daynight-server', 'acceptance-build', evidence.native.binary],
            { cwd: serverRoot, timeoutMs: 300_000 });
          evidence.native.binarySha256 = createHash('sha256').update(await readFile(evidence.native.binary)).digest('hex');
          await save();
          await ownedRun('docker', ['volume', 'create', '--label', `${labelKey}=${owner}`, evidence.native.postgresVolume], { quiet: true });
          await ownedRun('docker', ['run', '--detach', '--name', evidence.native.postgresContainer, '--label', `${labelKey}=${owner}`,
            '--publish', '127.0.0.1::5432', '--mount', `type=volume,src=${evidence.native.postgresVolume},dst=/var/lib/postgresql`,
            '--env', 'POSTGRES_USER=daynight', '--env', 'POSTGRES_DB=daynight', '--env', 'POSTGRES_PASSWORD=daynight-browser-fixture', postgresImage],
          { timeoutMs: 180_000, quiet: true });
          const deadline = Date.now() + 60_000;
          while (true) {
            const status = await ownedRun('docker', ['inspect', '--format', '{{.State.Running}}', evidence.native.postgresContainer], { quiet: true });
            if (status !== 'true') throw new Error('Owned PostgreSQL container stopped during startup.');
            try { await ownedRun('docker', ['exec', evidence.native.postgresContainer, 'pg_isready', '-h', '127.0.0.1', '-U', 'daynight', '-d', 'daynight'], { quiet: true, timeoutMs: 5_000 }); break; }
            catch (error) { if (Date.now() >= deadline || cancellation.signal.aborted) throw error; await wait(250); }
          }
          evidence.native.postgresVersion = await ownedRun('docker', ['exec', evidence.native.postgresContainer, 'postgres', '--version'], { quiet: true });
          if (!/^postgres \(PostgreSQL\) 18\.6(?:\s|$)/.test(evidence.native.postgresVersion)) throw new Error('Unexpected PostgreSQL version.');
          evidence.native.postgresImageId = await ownedRun('docker', ['inspect', '--format', '{{.Image}}', evidence.native.postgresContainer], { quiet: true });
          if (!/^sha256:[a-f0-9]{64}$/.test(evidence.native.postgresImageId)) throw new Error('Invalid native PostgreSQL image identity.');
          const endpoint = await ownedRun('docker', ['port', evidence.native.postgresContainer, '5432/tcp'], { quiet: true });
          if (!/^127\.0\.0\.1:[1-9]\d*$/.test(endpoint)) throw new Error('Native PostgreSQL lacks a unique loopback port.');
          const started = await startServer(evidence.native.binary,
            `postgres://daynight:daynight-browser-fixture@${endpoint}/daynight?sslmode=disable`, evidence.native,
            (ownedChild) => { child = ownedChild; }, save);
          child = started.child;
          nativeTarget = { target: 'native', result: 'running', baseUrl: started.baseUrl,
            postgresContainer: evidence.native.postgresContainer, projectLabel: { key: labelKey, value: owner }, database: 'daynight', phases: [] };
          evidence.targets.push(nativeTarget);
          await save();
        }),
        nativeFunctional: () => stage('native-functional', async () => {
          const phase = nativePhase('functional');
          await save();
          await playwright(phase, join(directory, 'native/functional'), installedEvidence());
          await save();
        }),
        releaseContainer: () => stage('container-release', async () => {
          cancellation.signal.throwIfAborted();
          if (devCiRunId === undefined) throw new Error('Dev-ci did not announce its owned run before browser release.');
          await writeContainerPermission(containerDirectory, { acceptanceRunId: runId, devCiRunId, sourceGitSha: evidence.source.gitSha });
        }),
        container: () => stage('container', async (ownedRun) => {
          console.log(`Web acceptance ${runId}: preparing the production container through dev-ci gateway.`);
          let runnerOutput = '';
          let runnerIdentitySaved: Promise<void> = Promise.resolve();
          evidence.devCi = {};
          try {
            await ownedRun('bash', ['deployment/dev-ci/run.sh', process.execPath, script, '--container'], {
              timeoutMs: 1_200_000, forceAfterMs: 180_000,
              env: { ...process.env, DAYNIGHT_ACCEPTANCE_DIRECTORY: containerDirectory },
              onOutput: (chunk) => {
                runnerOutput = `${runnerOutput}${chunk}`.slice(-4096);
                const match = /Dev-ci run ID: (\d{14}-\d+-\d{5})/.exec(runnerOutput);
                if (match !== null && devCiRunId === undefined) {
                  devCiRunId = match[1]!;
                  evidence.devCi!.runId = devCiRunId;
                  runnerIdentitySaved = runnerIdentitySaved.then(save);
                  void runnerIdentitySaved.catch(() => {});
                }
              },
              onSpawn: (runnerChild) => {
                runnerIdentitySaved = (async () => {
                  const identity = await processIdentity(runnerChild.pid!);
                  if (identity !== null) evidence.devCi!.runner = identity;
                  await save();
                })();
                void runnerIdentitySaved.catch(() => {});
              },
            });
          } finally { await runnerIdentitySaved; }
          const phase = await readJson(join(containerDirectory, 'target.json')) as BrowserPhase;
          if (phase.browserInventory === undefined) throw new Error('Container browser inventory is missing.');
          await recoverBrowsers(containerDirectory, phase.browserInventory);
          const receiptIdentity = await readJson(join(containerDirectory, 'dev-ci-run.json')) as { runId: string };
          if (receiptIdentity.runId !== devCiRunId) throw new Error('Container receipt differs from the announced dev-ci run.');
          const receipt = await readJson(join(repositoryRoot, '.tmp/dev-ci', receiptIdentity.runId, 'manifest.json')) as Record<string, unknown>;
          evidence.container = receipt;
          if (receipt.result !== 'passed' || receipt.cleanupResult !== 'passed' || !/^sha256:[a-f0-9]{64}$/.test(String(receipt.imageId))) {
            throw new Error('Dev-ci production image or cleanup receipt did not pass.');
          }
          const target: Target = { target: 'container', baseUrl: phase.baseUrl, postgresContainer: phase.postgresContainer,
            projectLabel: phase.projectLabel, database: phase.database, result: 'running', phases: [phase] };
          aggregate(target, functionalScenarios);
          evidence.targets.push(target);
          await save();
        }),
        capacity: () => stage('native-capacity', async () => {
          const phase = nativePhase('capacity');
          await save();
          await playwright(phase, join(directory, 'native/capacity'), installedEvidence());
          evidence.performance = await readJson(join(directory, 'native/capacity/performance.json'));
          validatePerformance(evidence.performance);
          aggregate(native(), [...functionalScenarios, ...capacityScenarios]);
          await save();
        }),
      });
      evidence.result = 'passed';
    } catch (error) {
      failure = error;
      evidence.result = 'failed';
      evidence.error = error instanceof Error ? error.message : String(error);
    } finally {
      const cleanupFailures: unknown[] = [];
      for (const phaseName of ['native/capacity', 'container', 'native/functional']) {
        const phaseDirectory = join(directory, phaseName);
        try {
          const phase = await optionalJson(join(phaseDirectory, 'target.json')) as BrowserPhase | undefined;
          if (phase?.playwrightProcess !== undefined) {
            await requireStopped(phase.playwrightProcess);
            requireGroupStopped(phase.playwrightProcess.group);
          }
          if (phase?.playwrightGroup !== undefined) requireGroupStopped(phase.playwrightGroup);
          if (phase?.browserInventory !== undefined) await recoverBrowsers(phaseDirectory, phase.browserInventory);
        } catch (error) { cleanupFailures.push(error); }
      }
      if (devCiRunId !== undefined) {
        try {
          evidence.container = await readJson(join(repositoryRoot, '.tmp/dev-ci', devCiRunId, 'manifest.json'));
          if ((evidence.container as Record<string, unknown>).cleanupResult !== 'passed') throw new Error('Dev-ci owned-resource cleanup did not pass.');
        } catch (error) { cleanupFailures.push(error); }
        if (!evidence.targets.some((target) => target.target === 'container')) {
          try {
            const phase = await optionalJson(join(containerDirectory, 'target.json')) as BrowserPhase | undefined;
            if (phase !== undefined) evidence.targets.push({ target: 'container', baseUrl: phase.baseUrl,
              postgresContainer: phase.postgresContainer, projectLabel: phase.projectLabel, database: phase.database,
              result: 'failed', phases: [phase] });
          } catch (error) { cleanupFailures.push(error); }
        }
      }
      for (const target of evidence.targets) if (target.result === 'running') target.result = 'failed';
      if (evidence.installedCli !== undefined) {
        try { await cleanupInstallation(evidence, directory, save); }
        catch (error) { evidence.installedCli.cleanup = 'failed'; cleanupFailures.push(error); }
      }
      const beforeNativeCleanup = cleanupFailures.length;
      try { await stopServer(child); } catch (error) { cleanupFailures.push(error); }
      try { await cleanupNativeStorage(evidence.native, runId); }
      catch (error) { cleanupFailures.push(error); }
      try { await cleanupNative(evidence.native); }
      catch (error) { cleanupFailures.push(error); }
      evidence.native.cleanup = cleanupFailures.length === beforeNativeCleanup ? 'passed' : 'failed';
      evidence.cleanup = cleanupFailures.length === 0 ? 'passed' : 'failed';
      if (cleanupFailures.length > 0) {
        evidence.result = 'failed';
        evidence.cleanupErrors = cleanupFailures.map((error) => error instanceof Error ? error.message : String(error));
        failure = new AggregateError([...(failure === undefined ? [] : [failure]), ...cleanupFailures], 'Web acceptance or owned-resource cleanup failed.');
        evidence.error = (failure as Error).message;
      }
      evidence.finishedAt = new Date().toISOString();
      try { await save(); }
      catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], 'Acceptance and final evidence recording failed.'); }
    }
    console.log(`Web acceptance ${runId}: result=${evidence.result}, cleanup=${evidence.cleanup}; evidence=${join(evidenceRoot, 'evidence.json')}`);
    if (failure !== undefined) throw failure;
  };

  return { main, containerCallback, recover };
};

export const runAcceptance = async (cancellation: AbortController, preparations?: AcceptancePreparations): Promise<void> =>
  createRunner(cancellation).main(preparations);
export const runContainerCallback = async (cancellation: AbortController): Promise<void> => createRunner(cancellation).containerCallback();
export const recoverAcceptance = async (cancellation: AbortController, runId?: string): Promise<void> => createRunner(cancellation).recover(runId);
