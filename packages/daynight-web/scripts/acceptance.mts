import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { command, type CommandOptions } from './acceptance/process.mts';
import { readReport, type Scenario } from './acceptance/report.mts';
import { validatePerformance } from './acceptance/performance.mts';
import { processIdentity, requireGroupStopped, requireStopped, sameProcess, type ProcessIdentity } from './acceptance/identity.mts';
import { browserInventory, recoverBrowsers, type BrowserInventory } from './acceptance/browser.mts';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = resolve(packageRoot, '../..');
const serverRoot = resolve(packageRoot, '../daynight-server');
const evidenceRoot = join(packageRoot, '.tmp/acceptance');
const script = fileURLToPath(import.meta.url);
const labelKey = 'io.daynight.acceptance.run';
const functionalScenarios = ['project-list', 'project-graph', 'detail-navigation', 'refresh-staleness',
  'failure-recovery', 'deep-links', 'keyboard-focus', 'narrow-layout'] as const;
const capacityScenarios = ['capacity-chain', 'capacity-merge', 'capacity-shared', 'capacity-limits'] as const;
const cancellation = new AbortController();
const onSignal = (): void => cancellation.abort();
process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);

const json = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.next`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${path}.next`, path);
};
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
const run = (file: string, args: readonly string[], options: Omit<CommandOptions, 'cwd'> & { cwd?: string } = {}): Promise<string> =>
  command(file, args, { cwd: repositoryRoot, signal: cancellation.signal, ...options });

type Source = { gitSha: string; githubSha: string | null; dirty: boolean };
type Target = {
  target: 'native' | 'container'; result: 'running' | 'passed' | 'failed'; baseUrl: string;
  postgresContainer: string; projectLabel: { key: string; value: string }; database: 'daynight';
  scenarios?: Scenario[]; browser?: unknown; error?: string;
  playwrightProcess?: ProcessIdentity;
  browserInventory?: BrowserInventory;
};
type NativeEvidence = {
  owner: string; postgresContainer: string; postgresVolume: string; binary: string; binarySha256?: string;
  processPid?: number; postgresImage: string; postgresImageId?: string; postgresVersion?: string; cleanup: 'pending' | 'passed' | 'failed';
  processIdentity?: ProcessIdentity;
};
type Evidence = {
  schemaVersion: 1; runId: string; source: Source; startedAt: string; result: 'running' | 'passed' | 'failed';
  native: NativeEvidence; targets: Target[]; container?: unknown; performance?: unknown;
  cleanup: 'pending' | 'passed' | 'failed'; finishedAt?: string; error?: string; cleanupErrors?: string[];
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

const playwright = async (target: Target, directory: string): Promise<Target> => {
  target.browserInventory = await browserInventory();
  await json(join(directory, 'target.json'), target);
  let identitySaved: Promise<void> = Promise.resolve();
  try {
    await mkdir(join(packageRoot, '.tmp'), { recursive: true });
    await run('pnpm', ['exec', 'playwright', 'test', '--workers=1', '--retries=0', '--reporter=line,json',
      ...(target.target === 'container' ? ['--grep-invert', '@capacity'] : [])], {
      cwd: packageRoot, timeoutMs: 900_000,
      env: { ...process.env, TMPDIR: '.tmp', DAYNIGHT_BASE_URL: target.baseUrl, DAYNIGHT_ACCEPTANCE_TARGET: target.target,
        DAYNIGHT_ACCEPTANCE_DIRECTORY: directory, PLAYWRIGHT_JSON_OUTPUT_FILE: join(directory, 'playwright.json') },
      onSpawn: (child) => {
        identitySaved = (async () => {
          const identity = await processIdentity(child.pid!);
          if (identity === null) throw new Error('Playwright process identity disappeared.');
          target.playwrightProcess = identity;
          await json(join(directory, 'target.json'), target);
        })();
        void identitySaved.catch(() => {});
      },
    });
    await identitySaved;
    const required = [...functionalScenarios, ...(target.target === 'native' ? capacityScenarios : [])];
    target.scenarios = readReport(await readJson(join(directory, 'playwright.json')), required);
    if (target.scenarios.length !== required.length) throw new Error('Acceptance report contains unexpected or duplicate scenarios.');
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
    target.result = 'passed';
  } catch (error) {
    target.result = 'failed';
    target.error = error instanceof Error ? error.message : 'Acceptance target failed.';
    throw error;
  } finally { await identitySaved; await json(join(directory, 'target.json'), target); }
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
  const project = `daynight-dev-ci-${runId}`;
  const callback = await processIdentity(process.pid);
  if (callback === null) throw new Error('Container callback process identity disappeared.');
  await json(join(directory, 'callback.json'), callback);
  const postgresContainer = await run('docker', ['ps', '--quiet', '--no-trunc', '--filter', `label=com.docker.compose.project=${project}`,
    '--filter', 'label=com.docker.compose.service=postgres'], { quiet: true, timeoutMs: 10_000 });
  if (!/^[a-f0-9]{64}$/.test(postgresContainer)) throw new Error('Dev-ci PostgreSQL container was not uniquely identified.');
  await json(join(directory, 'dev-ci-run.json'), { runId });
  await playwright({ target: 'container', result: 'running', baseUrl, postgresContainer,
    projectLabel: { key: 'com.docker.compose.project', value: project }, database: 'daynight' }, directory);
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
  const child = spawn(binary, [], { cwd: serverRoot, env: { ...process.env, DAYNIGHT_DATABASE_URL: databaseUrl, DAYNIGHT_LISTEN_ADDR: '127.0.0.1:0' },
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
    child.once('exit', () => { finish(); if (!ready) reject(new Error('Native Go process exited before readiness.')); });
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

const recover = async (requestedRunId: string | undefined): Promise<void> => {
  if (requestedRunId !== undefined && !/^\d{14}-[a-f0-9-]{36}$/.test(requestedRunId)) throw new Error('Invalid acceptance recovery run ID.');
  const original = await optionalJson(requestedRunId === undefined ? join(evidenceRoot, 'evidence.json') : join(evidenceRoot, requestedRunId, 'evidence.json'));
  if (original === undefined) { console.log('Web acceptance recovery: no run receipt; no resources were changed.'); return; }
  const evidence = original as Evidence;
  if (evidence.schemaVersion !== 1 || !/^\d{14}-[a-f0-9-]{36}$/.test(evidence.runId)
    || (requestedRunId !== undefined && evidence.runId !== requestedRunId)) throw new Error('Invalid acceptance recovery receipt.');
  const directory = join(evidenceRoot, evidence.runId);
  const owner = `daynight-web-${evidence.runId}`;
  const native = evidence.native;
  if (native.owner !== owner || native.postgresContainer !== `${owner}-postgres` || native.postgresVolume !== `${owner}-data`
    || native.binary !== join(directory, 'daynight-server') || !/^[a-f0-9]{40}$/.test(evidence.source.gitSha)
    || (process.env.GITHUB_SHA !== undefined && evidence.source.githubSha !== process.env.GITHUB_SHA)) {
    throw new Error('Recovery receipt does not identify this run resources and source.');
  }
  const receipt: Record<string, unknown> = { schemaVersion: 1, runId: evidence.runId, result: 'running', startedAt: new Date().toISOString() };
  const save = async (): Promise<void> => {
    await json(join(directory, 'recovery.json'), receipt);
    await json(join(evidenceRoot, 'recovery.json'), receipt);
  };
  await save();
  try {
    await requireStopped(validIdentity(evidence.runner));
    if (evidence.devCi?.runner !== undefined) {
      const identity = validIdentity(evidence.devCi.runner);
      await requireStopped(identity); requireGroupStopped(identity.pid);
    }
    const callback = await optionalJson(join(directory, 'container/callback.json'));
    if (callback !== undefined) {
      const identity = validIdentity(callback);
      await requireStopped(identity); requireGroupStopped(identity.pid);
    }
    for (const targetName of ['native', 'container']) {
      const targetDirectory = join(directory, targetName);
      const target = await optionalJson(join(targetDirectory, 'target.json')) as Target | undefined;
      if (target?.playwrightProcess !== undefined) {
        const identity = validIdentity(target.playwrightProcess);
        await requireStopped(identity); requireGroupStopped(identity.pid);
      }
      if (target?.browserInventory !== undefined) await recoverBrowsers(targetDirectory, target.browserInventory);
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

const main = async (): Promise<void> => {
  const compose = await readFile(join(repositoryRoot, 'deployment/dev-ci/compose.yaml'), 'utf8');
  const images = [...compose.matchAll(/^\s+image:\s+(postgres:18\.6-bookworm@sha256:[a-f0-9]{64})\s*$/gm)];
  if (images.length !== 1) throw new Error('Dev-ci must declare exactly one pinned PostgreSQL 18.6 image.');
  const postgresImage = images[0]![1]!;
  const runId = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID()}`;
  const directory = join(evidenceRoot, runId);
  const nativeDirectory = join(directory, 'native');
  const containerDirectory = join(directory, 'container');
  const owner = `daynight-web-${runId}`;
  const runner = await processIdentity(process.pid);
  if (runner === null) throw new Error('Acceptance runner process identity disappeared.');
  const evidence: Evidence = { schemaVersion: 1, runId, source: await sourceIdentity(), startedAt: new Date().toISOString(),
    result: 'running', native: { owner, postgresContainer: `${owner}-postgres`, postgresVolume: `${owner}-data`,
      binary: join(directory, 'daynight-server'), postgresImage, cleanup: 'pending' }, targets: [], cleanup: 'pending', runner };
  let evidenceWrites = Promise.resolve();
  const save = (): Promise<void> => {
    evidenceWrites = evidenceWrites.then(async () => {
      await json(join(directory, 'evidence.json'), evidence);
      await json(join(evidenceRoot, 'evidence.json'), evidence);
    });
    return evidenceWrites;
  };
  let child: ChildProcess | undefined;
  let devCiRunId: string | undefined;
  let failure: unknown;
  await save();
  try {
    console.log(`Web acceptance ${runId}: building production assets and native Go executable.`);
    await run('pnpm', ['web:build'], { timeoutMs: 180_000 });
    await run('bash', ['-c', 'source scripts/env.sh\ngo build -o "$1" ./cmd/daynight-server', 'acceptance-build', evidence.native.binary],
      { cwd: serverRoot, timeoutMs: 300_000 });
    evidence.native.binarySha256 = createHash('sha256').update(await readFile(evidence.native.binary)).digest('hex');
    await save();
    await run('docker', ['volume', 'create', '--label', `${labelKey}=${owner}`, evidence.native.postgresVolume], { quiet: true });
    await run('docker', ['run', '--detach', '--name', evidence.native.postgresContainer, '--label', `${labelKey}=${owner}`,
      '--publish', '127.0.0.1::5432', '--mount', `type=volume,src=${evidence.native.postgresVolume},dst=/var/lib/postgresql`,
      '--env', 'POSTGRES_USER=daynight', '--env', 'POSTGRES_DB=daynight', '--env', 'POSTGRES_PASSWORD=daynight-browser-fixture', postgresImage],
    { timeoutMs: 180_000, quiet: true });
    const deadline = Date.now() + 60_000;
    while (true) {
      const status = await run('docker', ['inspect', '--format', '{{.State.Running}}', evidence.native.postgresContainer], { quiet: true });
      if (status !== 'true') throw new Error('Owned PostgreSQL container stopped during startup.');
      try { await run('docker', ['exec', evidence.native.postgresContainer, 'pg_isready', '-h', '127.0.0.1', '-U', 'daynight', '-d', 'daynight'], { quiet: true, timeoutMs: 5_000 }); break; }
      catch (error) { if (Date.now() >= deadline || cancellation.signal.aborted) throw error; await wait(250); }
    }
    evidence.native.postgresVersion = await run('docker', ['exec', evidence.native.postgresContainer, 'postgres', '--version'], { quiet: true });
    if (!/^postgres \(PostgreSQL\) 18\.6(?:\s|$)/.test(evidence.native.postgresVersion)) throw new Error('Unexpected PostgreSQL version.');
    evidence.native.postgresImageId = await run('docker', ['inspect', '--format', '{{.Image}}', evidence.native.postgresContainer], { quiet: true });
    if (!/^sha256:[a-f0-9]{64}$/.test(evidence.native.postgresImageId)) throw new Error('Invalid native PostgreSQL image identity.');
    const endpoint = await run('docker', ['port', evidence.native.postgresContainer, '5432/tcp'], { quiet: true });
    if (!/^127\.0\.0\.1:[1-9]\d*$/.test(endpoint)) throw new Error('Native PostgreSQL lacks a unique loopback port.');
    const started = await startServer(evidence.native.binary,
      `postgres://daynight:daynight-browser-fixture@${endpoint}/daynight?sslmode=disable`, evidence.native,
      (ownedChild) => { child = ownedChild; }, save);
    child = started.child;
    await save();
    const nativeTarget: Target = { target: 'native', result: 'running', baseUrl: started.baseUrl,
      postgresContainer: evidence.native.postgresContainer, projectLabel: { key: labelKey, value: owner }, database: 'daynight' };
    evidence.targets.push(nativeTarget); await save();
    await playwright(nativeTarget, nativeDirectory);
    evidence.performance = await readJson(join(nativeDirectory, 'performance.json'));
    validatePerformance(evidence.performance);
    await stopServer(child); child = undefined;
    await cleanupNative(evidence.native); evidence.native.cleanup = 'passed'; await save();
    console.log(`Web acceptance ${runId}: testing the production container through dev-ci gateway.`);
    let runnerOutput = '';
    let runnerIdentitySaved: Promise<void> = Promise.resolve();
    evidence.devCi = {};
    await run('bash', ['deployment/dev-ci/run.sh', process.execPath, script, '--container'], {
      timeoutMs: 1_200_000, forceAfterMs: 180_000, env: { ...process.env, DAYNIGHT_ACCEPTANCE_DIRECTORY: containerDirectory },
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
          if (identity === null) throw new Error('Dev-ci runner process identity disappeared.');
          evidence.devCi!.runner = identity;
          await save();
        })();
        void runnerIdentitySaved.catch(() => {});
      },
    });
    await runnerIdentitySaved;
    const target = await readJson(join(containerDirectory, 'target.json')) as Target;
    evidence.targets.push(target);
    const receiptIdentity = await readJson(join(containerDirectory, 'dev-ci-run.json')) as { runId: string };
    const receipt = await readJson(join(repositoryRoot, '.tmp/dev-ci', receiptIdentity.runId, 'manifest.json')) as Record<string, unknown>;
    evidence.container = receipt;
    if (receipt.result !== 'passed' || receipt.cleanupResult !== 'passed' || !/^sha256:[a-f0-9]{64}$/.test(String(receipt.imageId))) {
      throw new Error('Dev-ci production image or cleanup receipt did not pass.');
    }
    if (target.result !== 'passed') throw new Error('Container browser target did not pass.');
    evidence.result = 'passed';
  } catch (error) {
    failure = error; evidence.result = 'failed'; evidence.error = error instanceof Error ? error.message : 'Web acceptance failed.';
  } finally {
    const cleanupFailures: unknown[] = [];
    for (const targetName of ['native', 'container']) {
      const targetDirectory = join(directory, targetName);
      try {
        const target = await optionalJson(join(targetDirectory, 'target.json')) as Target | undefined;
        if (target?.browserInventory !== undefined) await recoverBrowsers(targetDirectory, target.browserInventory);
      } catch (error) { cleanupFailures.push(error); }
    }
    if (devCiRunId !== undefined) {
      try {
        evidence.container = await readJson(join(repositoryRoot, '.tmp/dev-ci', devCiRunId, 'manifest.json'));
        if ((evidence.container as Record<string, unknown>).cleanupResult !== 'passed') throw new Error('Dev-ci owned-resource cleanup did not pass.');
      } catch (error) { cleanupFailures.push(error); }
      if (!evidence.targets.some((target) => target.target === 'container')) {
        try { evidence.targets.push(await readJson(join(containerDirectory, 'target.json')) as Target); }
        catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) cleanupFailures.push(error);
        }
      }
    }
    try { await stopServer(child); } catch (error) { cleanupFailures.push(error); }
    try { await cleanupNative(evidence.native); evidence.native.cleanup = 'passed'; }
    catch (error) { evidence.native.cleanup = 'failed'; cleanupFailures.push(error); }
    evidence.cleanup = cleanupFailures.length === 0 ? 'passed' : 'failed';
    if (cleanupFailures.length > 0) {
      evidence.result = 'failed';
      evidence.cleanupErrors = cleanupFailures.map((error) => error instanceof Error ? error.message : 'Owned-resource cleanup failed.');
      failure = new AggregateError([...(failure === undefined ? [] : [failure]), ...cleanupFailures], 'Web acceptance or owned-resource cleanup failed.');
      evidence.error ??= (failure as Error).message;
    }
    evidence.finishedAt = new Date().toISOString();
    await save();
  }
  console.log(`Web acceptance ${runId}: result=${evidence.result}, cleanup=${evidence.cleanup}; evidence=${join(evidenceRoot, 'evidence.json')}`);
  if (failure !== undefined) throw failure;
};

try {
  if (process.argv.length === 3 && process.argv[2] === '--container') await containerCallback();
  else if ((process.argv.length === 3 || process.argv.length === 4) && process.argv[2] === '--cleanup') await recover(process.argv[3]);
  else if (process.argv.length === 2) await main();
  else throw new Error('Usage: node scripts/acceptance.mts [--cleanup [run-id]]');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Web acceptance failed.');
  process.exitCode = 1;
} finally {
  process.removeListener('SIGTERM', onSignal);
  process.removeListener('SIGINT', onSignal);
}
