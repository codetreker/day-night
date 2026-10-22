import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { processIdentity } from './identity.mts';
import { launchNativeServer } from './runner.mts';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const temporaryRoot = join(packageRoot, '.tmp');
const evidenceRoot = join(temporaryRoot, 'acceptance');
const runner = new URL('./runner.mts', import.meta.url).href;
const cli = fileURLToPath(new URL('../acceptance.mts', import.meta.url));
const sourceGitSha = '0123456789abcdef0123456789abcdef01234567';
const runId = (): string => `20261021123456-${randomUUID()}`;
type Fixture = { directory: string; bin: string; commands: string; env: NodeJS.ProcessEnv };

const fixture = async (run: (value: Fixture) => Promise<void>): Promise<void> => {
  await mkdir(temporaryRoot, { recursive: true });
  const recoveryPath = join(evidenceRoot, 'recovery.json');
  let previousRecovery: Buffer | undefined;
  try { previousRecovery = await readFile(recoveryPath); }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  const directory = await mkdtemp(join(temporaryRoot, 'acceptance-runner-test-'));
  const bin = join(directory, 'bin');
  const commands = join(directory, 'commands.log');
  await mkdir(bin);
  await writeFile(commands, '');
  for (const name of ['git', 'docker', 'pnpm', 'bash']) {
    const path = join(bin, name);
    await writeFile(path, '#!/bin/sh\nprintf \'%s\\n\' "$0 $*" >> "$DAYNIGHT_TEST_COMMAND_LOG"\nexit 91\n');
    await chmod(path, 0o755);
  }
  try {
    await run({ directory, bin, commands, env: { ...process.env, PATH: bin, DAYNIGHT_TEST_COMMAND_LOG: commands,
      PLAYWRIGHT_BROWSERS_PATH: join(directory, 'browsers-not-installed'), DAYNIGHT_BROWSER_EXECUTABLE: undefined } });
  } finally {
    if (previousRecovery === undefined) await rm(recoveryPath, { force: true });
    else await writeFile(recoveryPath, previousRecovery);
    await rm(directory, { recursive: true, force: true });
  }
};

const start = (args: readonly string[], value: Fixture, ipc = false) => {
  const child = spawn(process.execPath, args, { cwd: value.directory, env: value.env,
    stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let error: Error | undefined;
  let timedOut = false;
  child.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
  child.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 5_000);
  child.once('error', (failure) => { error = failure; });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; error: Error | undefined; timedOut: boolean }>((resolve) => {
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, error, timedOut }); });
  });
  return { child, done };
};

const readyReceipt = async (path: string, running: ReturnType<typeof start>): Promise<Record<string, unknown>> => {
  const deadline = performance.now() + 3_000;
  for (;;) {
    if (running.child.exitCode !== null || running.child.signalCode !== null) {
      assert.fail(`Container callback exited before readiness: ${JSON.stringify(await running.done)}`);
    }
    try { return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>; }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    if (performance.now() >= deadline) throw new Error('Container callback did not persist readiness.');
    await delay(10);
  }
};

test('importing the acceptance runner executes no commands or signal registration', { skip: process.platform === 'win32' }, async () => {
  await fixture(async (value) => {
    const running = start(['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
      const runner = await import(${JSON.stringify(runner)});
      for (const name of ['runAcceptance', 'runContainerCallback', 'recoverAcceptance']) assert.equal(typeof runner[name], 'function');
      assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
      console.log('imported-without-starting');
    `], value);
    const result = await running.done;
    assert.equal(result.error, undefined);
    assert.equal(result.timedOut, false);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, 'imported-without-starting\n');
    assert.equal(result.stderr, '');
    assert.equal(await readFile(value.commands, 'utf8'), '');
    assert.deepEqual((await readdir(value.directory)).sort(), ['bin', 'commands.log']);
  });
});

test('the thin CLI rejects unknown arguments before starting acceptance', { skip: process.platform === 'win32' }, async () => {
  await fixture(async (value) => {
    const result = await start([cli, '--unknown'], value).done;
    assert.equal(result.timedOut, false);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Usage: node scripts\/acceptance\.mts \[--cleanup \[run-id\]\]/);
    assert.equal(await readFile(value.commands, 'utf8'), '');
  });
});

test('recovery rejects unsupported receipt schemas before issuing Docker commands', { skip: process.platform === 'win32' }, async () => {
  await fixture(async (value) => {
    for (const schemaVersion of [1, 99]) {
      const id = runId();
      const directory = join(evidenceRoot, id);
      await mkdir(directory, { recursive: true });
      try {
        await writeFile(join(directory, 'evidence.json'), JSON.stringify({ schemaVersion, runId: id }));
        const result = await start([cli, '--cleanup', id], value).done;
        assert.equal(result.timedOut, false);
        assert.equal(result.code, 1);
        assert.match(result.stderr, /Invalid acceptance recovery receipt/);
        assert.equal(await readFile(value.commands, 'utf8'), '');
        assert.deepEqual(await readdir(directory), ['evidence.json']);
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
});

test('recovery removes only the recorded native storage after confirming the native process is absent', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async (value) => {
    const id = runId();
    const directory = join(evidenceRoot, id);
    const storageRoot = join(directory, 'native-storage');
    const operatorStorage = join(value.directory, 'operator-storage');
    const owner = `daynight-web-${id}`;
    const evidence = {
      schemaVersion: 2, runId: id, source: { gitSha: sourceGitSha, githubSha: process.env.GITHUB_SHA ?? null },
      runner: { pid: 2_147_483_647, executable: process.execPath, startTicks: '1', group: 2_147_483_647 }, stages: [],
      native: { owner, postgresContainer: `${owner}-postgres`, postgresVolume: `${owner}-data`,
        binary: join(directory, 'daynight-server'), storageRoot },
    };
    await mkdir(storageRoot, { recursive: true });
    await mkdir(operatorStorage);
    await writeFile(join(storageRoot, 'owned-file'), 'owned');
    await writeFile(join(operatorStorage, 'preserved-file'), 'operator');
    await writeFile(join(value.bin, 'docker'), '#!/bin/sh\nprintf \'%s\\n\' "$0 $*" >> "$DAYNIGHT_TEST_COMMAND_LOG"\n');
    value.env.DAYNIGHT_STORAGE_ROOT = operatorStorage;
    try {
      await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence));
      const result = await start([cli, '--cleanup', id], value).done;
      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0, result.stderr);
      await assert.rejects(readFile(join(storageRoot, 'owned-file')), { code: 'ENOENT' });
      assert.equal(await readFile(join(operatorStorage, 'preserved-file'), 'utf8'), 'operator');
      const receipt = JSON.parse(await readFile(join(directory, 'recovery.json'), 'utf8')) as Record<string, unknown>;
      assert.equal(receipt.nativeProcess, 'not-started');
      assert.equal(receipt.nativeStorage, 'passed');
      assert.equal(receipt.result, 'passed');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

test('recovery refuses a storage path outside its run and preserves storage while the native process is live', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async (value) => {
    for (const invalid of ['path', 'process']) {
      const id = runId();
      const directory = join(evidenceRoot, id);
      const storageRoot = join(directory, 'native-storage');
      const owner = `daynight-web-${id}`;
      const evidence = {
        schemaVersion: 2, runId: id, source: { gitSha: sourceGitSha, githubSha: process.env.GITHUB_SHA ?? null },
        runner: { pid: 2_147_483_647, executable: process.execPath, startTicks: '1', group: 2_147_483_647 }, stages: [],
        native: { owner, postgresContainer: `${owner}-postgres`, postgresVolume: `${owner}-data`,
          binary: join(directory, 'daynight-server'), storageRoot: invalid === 'path' ? value.directory : storageRoot,
          ...(invalid === 'process' ? { processPid: process.pid } : {}) },
      };
      await mkdir(storageRoot, { recursive: true });
      await writeFile(join(storageRoot, 'owned-file'), 'owned');
      try {
        await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence));
        const result = await start([cli, '--cleanup', id], value).done;
        assert.equal(result.timedOut, false);
        assert.equal(result.code, 1);
        assert.match(result.stderr, invalid === 'path' ? /Recovery receipt does not identify/ : /Owned process lacks enough identity/);
        assert.equal(await readFile(join(storageRoot, 'owned-file'), 'utf8'), 'owned');
        assert.equal(await readFile(value.commands, 'utf8'), '');
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
});

test('an early container callback records readiness and waits for permission before inspecting Chromium', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async (value) => {
    const id = runId();
    const devCiRunId = '20261021123457-1234-56789';
    const directory = join(evidenceRoot, id);
    const containerDirectory = join(directory, 'container');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'evidence.json'), JSON.stringify({ schemaVersion: 2, runId: id, source: { gitSha: sourceGitSha } }));
    await writeFile(join(value.bin, 'docker'), '#!/bin/sh\nprintf \'%s\\n\' "$0 $*" >> "$DAYNIGHT_TEST_COMMAND_LOG"\nif [ "$1" != ps ]; then exit 91; fi\nprintf \'%s\\n\' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
    value.env = { ...value.env, DAYNIGHT_ACCEPTANCE_DIRECTORY: containerDirectory, DAYNIGHT_DEV_CI_RUN_ID: devCiRunId,
      DAYNIGHT_BASE_URL: 'http://127.0.0.1:12345' };
    const running = start(['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { getEventListeners } from 'node:events';
      import { runContainerCallback } from ${JSON.stringify(runner)};
      const cancellation = new AbortController();
      const reason = new Error('callback-test-abort');
      const receive = (message) => {
        if (message === 'status') process.send('waiting-for-permission');
        else if (message === 'abort') cancellation.abort(reason);
      };
      process.on('message', receive);
      try {
        await runContainerCallback(cancellation);
        throw new Error('Container callback completed without permission.');
      } catch (error) {
        assert.equal(cancellation.signal.aborted, true);
        assert.ok(error === reason || error.cause === reason);
        assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0);
        assert.equal(process.getActiveResourcesInfo().filter((type) => type === 'Timeout').length, 0);
        console.log('callback-aborted-cleanly');
      } finally {
        process.removeListener('message', receive);
        process.disconnect();
      }
    `], value, true);
    try {
      const ready = await readyReceipt(join(containerDirectory, 'ready.json'), running);
      assert.equal(ready.acceptanceRunId, id);
      assert.equal(ready.devCiRunId, devCiRunId);
      assert.equal(ready.sourceGitSha, sourceGitSha);
      assert.equal((ready.callback as { pid: number }).pid, running.child.pid);
      assert.deepEqual(JSON.parse(await readFile(join(containerDirectory, 'dev-ci-run.json'), 'utf8')), { runId: devCiRunId });
      assert.deepEqual(JSON.parse(await readFile(join(containerDirectory, 'callback.json'), 'utf8')), ready.callback);
      const status = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => { running.child.removeListener('message', receive); reject(new Error('Container callback stopped responding while gated.')); }, 1_000);
        const receive = (message: unknown): void => { clearTimeout(timer); running.child.removeListener('message', receive); resolve(message); };
        running.child.once('message', receive);
      });
      running.child.send('status');
      assert.equal(await status, 'waiting-for-permission');
      assert.deepEqual((await readdir(containerDirectory)).sort(), ['callback.json', 'dev-ci-run.json', 'ready.json']);
      const commands = (await readFile(value.commands, 'utf8')).trim().split('\n');
      assert.equal(commands.length, 1);
      assert.match(commands[0]!, /docker ps --quiet --no-trunc --filter label=com\.docker\.compose\.project=daynight-dev-ci-/);
      running.child.send('abort');
      const result = await running.done;
      assert.equal(result.error, undefined);
      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, 'callback-aborted-cleanly\n');
      assert.equal(result.stderr, '');
      assert.deepEqual((await readdir(containerDirectory)).sort(), ['callback.json', 'dev-ci-run.json', 'ready.json']);
      assert.equal(await processIdentity(running.child.pid!), null);
    } finally {
      if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL');
      await running.done;
      await rm(directory, { recursive: true, force: true });
    }
  });
});

const installationRecoveryFixture = async (value: Fixture, completed: boolean) => {
  const id = runId();
  const directory = join(evidenceRoot, id);
  const root = join(directory, 'installed-cli');
  const storageRoot = join(directory, 'native-storage');
  const owner = `daynight-web-${id}`;
  const source = { gitSha: sourceGitSha, dirty: true, githubSha: process.env.GITHUB_SHA ?? null };
  const installedCli: Record<string, unknown> = { root, cleanup: 'pending' };
  await mkdir(root, { recursive: true });
  await mkdir(storageRoot);
  await writeFile(join(root, 'partial-install'), 'owned preparation');
  await writeFile(join(storageRoot, 'owned-file'), 'owned native storage');
  if (completed) {
    const entryPath = join(root, 'consumer install/node_modules/@codetreker/daynight/dist/main.js');
    const launcherPath = join(root, 'consumer install/node_modules/.bin/daynight');
    const tarballPath = join(root, 'daynight.tgz');
    await mkdir(join(root, 'consumer install/node_modules/@codetreker/daynight/dist'), { recursive: true });
    await mkdir(join(root, 'consumer install/node_modules/.bin'));
    await writeFile(entryPath, 'export {};');
    await writeFile(launcherPath, 'launcher');
    await writeFile(tarballPath, 'packed');
    const version = (JSON.parse(await readFile(new URL('../../../daynight/package.json', import.meta.url), 'utf8')) as { version: string }).version;
    await writeFile(join(root, 'consumer install/node_modules/@codetreker/daynight/package.json'), JSON.stringify({ name: '@codetreker/daynight', version, bin: { daynight: 'dist/main.js' } }));
    const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
    const receipt = { schemaVersion: 1, root, packageVersion: version, entryPath, entrySha256: await digest(entryPath),
      launcherPath, tarballPath, tarballSha256: await digest(tarballPath), nodePath: process.execPath, source: { gitSha: source.gitSha, dirty: source.dirty } };
    const receiptPath = join(root, 'installed-cli.json');
    installedCli.receipt = receipt;
    installedCli.receiptPath = receiptPath;
    await writeFile(receiptPath, JSON.stringify(receipt));
  }
  const evidence = { schemaVersion: 2, runId: id, source, installedCli,
    runner: { pid: 2_147_483_647, executable: process.execPath, startTicks: '1', group: 2_147_483_647 }, stages: [],
    native: { owner, postgresContainer: `${owner}-postgres`, postgresVolume: `${owner}-data`, binary: join(directory, 'daynight-server'), storageRoot } };
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence));
  value.env.CI = undefined;
  return { id, directory, root, evidence };
};

test('recovery owns an interrupted preparation root before any installed receipt exists and is repeatable', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async (value) => {
    const current = await installationRecoveryFixture(value, false);
    const operator = join(value.directory, 'operator-installed-cli');
    await mkdir(operator);
    await writeFile(join(operator, 'keep'), 'operator');
    await writeFile(join(value.bin, 'docker'), '#!/bin/sh\nexit 0\n');
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await start([cli, '--cleanup', current.id], value).done;
        assert.equal(result.code, 0, result.stderr);
        await assert.rejects(readFile(join(current.root, 'partial-install')), { code: 'ENOENT' });
        assert.equal(await readFile(join(operator, 'keep'), 'utf8'), 'operator');
        const evidence = JSON.parse(await readFile(join(current.directory, 'evidence.json'), 'utf8')) as { installedCli: { cleanup: string } };
        assert.equal(evidence.installedCli.cleanup, 'passed');
      }
    } finally { await rm(current.directory, { recursive: true, force: true }); }
  });
});

test('installed cleanup remains committed when later Docker cleanup fails and a new recovery retries', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async (value) => {
    const current = await installationRecoveryFixture(value, true);
    await writeFile(join(value.bin, 'docker'), '#!/bin/sh\nexit 91\n');
    try {
      const failed = await start([cli, '--cleanup', current.id], value).done;
      assert.equal(failed.code, 1);
      await assert.rejects(readFile(join(current.root, 'installed-cli.json')), { code: 'ENOENT' });
      const evidence = JSON.parse(await readFile(join(current.directory, 'evidence.json'), 'utf8')) as { installedCli: { cleanup: string } };
      assert.equal(evidence.installedCli.cleanup, 'passed');
      await writeFile(join(value.bin, 'docker'), '#!/bin/sh\nexit 0\n');
      const retried = await start([cli, '--cleanup', current.id], value).done;
      assert.equal(retried.code, 0, retried.stderr);
      const receipt = JSON.parse(await readFile(join(current.directory, 'recovery.json'), 'utf8')) as { installedCli: string; nativeDocker: string; result: string };
      assert.deepEqual({ installedCli: receipt.installedCli, nativeDocker: receipt.nativeDocker, result: receipt.result }, { installedCli: 'passed', nativeDocker: 'passed', result: 'passed' });
    } finally { await rm(current.directory, { recursive: true, force: true }); }
  });
});

test('partial installation cleanup rejects a root outside the recorded run', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async (value) => {
    const current = await installationRecoveryFixture(value, false);
    current.evidence.installedCli.root = value.directory;
    await writeFile(join(current.directory, 'evidence.json'), JSON.stringify(current.evidence));
    try {
      const result = await start([cli, '--cleanup', current.id], value).done;
      assert.equal(result.code, 1);
      assert.match(result.stderr, /preparation ownership differs/);
      assert.equal(await readFile(join(current.root, 'partial-install'), 'utf8'), 'owned preparation');
      assert.equal(await readFile(value.commands, 'utf8'), '');
    } finally { await rm(current.directory, { recursive: true, force: true }); }
  });
});

test('partial installation is retained while a recorded preparation process is still alive', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async (value) => {
    const current = await installationRecoveryFixture(value, false);
    const identity = await processIdentity(process.pid);
    assert.notEqual(identity, null);
    await writeFile(join(current.directory, 'evidence.json'), JSON.stringify({ ...current.evidence, stages: [{ commands: [identity], commandGroups: [] }] }));
    try {
      const result = await start([cli, '--cleanup', current.id], value).done;
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Original acceptance process is still running/);
      assert.equal(await readFile(join(current.root, 'partial-install'), 'utf8'), 'owned preparation');
      assert.equal(await readFile(value.commands, 'utf8'), '');
    } finally { await rm(current.directory, { recursive: true, force: true }); }
  });
});

const nativeProgram = async (directory: string, body: string): Promise<string> => {
  const path = join(directory, 'native-program');
  await writeFile(path, `#!${process.execPath}\n${body}\n`);
  await chmod(path, 0o755);
  return path;
};

const stopNativeProgram = async (child: ChildProcess | undefined): Promise<void> => {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  child.kill('SIGTERM');
  await closed;
};

test('native startup supplies normal auth configuration and waits for persisted ownership before readiness', { skip: process.platform === 'win32' }, async () => {
  await fixture(async (value) => {
    const configuration = join(value.directory, 'native-environment.json');
    const binary = await nativeProgram(value.directory, `
      const { writeFileSync } = await import('node:fs');
      const keys = ['DAYNIGHT_DATABASE_URL', 'DAYNIGHT_LISTEN_ADDR', 'DAYNIGHT_STORAGE_ROOT', 'DAYNIGHT_PUBLIC_ORIGIN',
        'DAYNIGHT_UNIAUTH_URL', 'DAYNIGHT_UNIAUTH_APP_ID', 'DAYNIGHT_UNIAUTH_APP_SECRET', 'DAYNIGHT_UNIAUTH_CALLBACK_URL',
        'DAYNIGHT_ALLOW_HTTP_TEST_ORIGIN', 'DAYNIGHT_ALLOW_LOOPBACK_HTTP'];
      writeFileSync(${JSON.stringify(configuration)}, JSON.stringify(Object.fromEntries(keys.map(key => [key, process.env[key]]))), {mode: 0o600});
      process.stderr.write(JSON.stringify({phase: 'listening', address: process.env.DAYNIGHT_LISTEN_ADDR}) + '\\n');
      process.on('SIGTERM', () => process.exit(0));
      setInterval(() => {}, 1000);
    `);
    let release = (): void => {};
    const recorded = new Promise<void>((resolve) => { release = resolve; });
    let child: ChildProcess | undefined;
    let settled = false;
    const cancellation = new AbortController();
    const started = launchNativeServer({ binary, databaseUrl: 'postgres://fixture', storageRoot: join(value.directory, 'storage'),
      baseUrl: 'http://127.0.0.1:23456', auth: { origin: 'http://127.0.0.1:23457', appId: 'fixture-app', appSecret: 'private-app-secret' },
      signal: cancellation.signal, onSpawn: async (owned) => { child = owned; await recorded; }, onUnexpectedExit: () => {} });
    void started.then(() => { settled = true; }, () => { settled = true; });
    try {
      const deadline = performance.now() + 2_000;
      let environment: Record<string, string> | undefined;
      while (environment === undefined) {
        try { environment = JSON.parse(await readFile(configuration, 'utf8')) as Record<string, string>; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (performance.now() >= deadline) throw new Error('Native program did not receive its configuration.');
        if (environment === undefined) await delay(10);
      }
      assert.equal(settled, false);
      assert.deepEqual(environment, { DAYNIGHT_DATABASE_URL: 'postgres://fixture', DAYNIGHT_LISTEN_ADDR: '127.0.0.1:23456',
        DAYNIGHT_STORAGE_ROOT: join(value.directory, 'storage'), DAYNIGHT_PUBLIC_ORIGIN: 'http://127.0.0.1:23456',
        DAYNIGHT_UNIAUTH_URL: 'http://127.0.0.1:23457', DAYNIGHT_UNIAUTH_APP_ID: 'fixture-app', DAYNIGHT_UNIAUTH_APP_SECRET: 'private-app-secret',
        DAYNIGHT_UNIAUTH_CALLBACK_URL: 'http://127.0.0.1:23456/api/v1/auth/callback', DAYNIGHT_ALLOW_HTTP_TEST_ORIGIN: '1', DAYNIGHT_ALLOW_LOOPBACK_HTTP: '1' });
      release();
      assert.equal(await started, child);
      assert.equal(await readFile(value.commands, 'utf8'), '');
    } finally {
      release();
      await stopNativeProgram(child);
      await started.catch(() => {});
    }
  });
});

test('native startup rejects mismatched origins and classifies only a proven address conflict for retry', { skip: process.platform === 'win32' }, async () => {
  await fixture(async (value) => {
    for (const kind of ['mismatched-origin', 'address-in-use', 'database-failure']) {
      const record = kind === 'mismatched-origin' ? { phase: 'listening', address: '127.0.0.1:23458' }
        : { phase: 'startup', diagnostic: kind === 'address-in-use' ? 'HTTP listen failed' : 'database open failed', cause: 'address_in_use' };
      const binary = await nativeProgram(value.directory, `
        process.stderr.write(${JSON.stringify(JSON.stringify(record) + '\n')});
        process.exitCode = 1;
      `);
      let child: ChildProcess | undefined;
      try {
        await assert.rejects(launchNativeServer({ binary, databaseUrl: 'postgres://fixture', storageRoot: join(value.directory, 'storage'),
          baseUrl: 'http://127.0.0.1:23456', auth: { origin: 'http://127.0.0.1:23457', appId: 'fixture-app', appSecret: 'private-app-secret' },
          signal: new AbortController().signal, onSpawn: async (owned) => { child = owned; }, onUnexpectedExit: () => {} }),
          (error: Error) => {
            assert.equal(error.constructor.name === 'NativeAddressInUseError', kind === 'address-in-use');
            assert.match(error.message, kind === 'mismatched-origin' ? /listener differs/ : kind === 'address-in-use' ? /port is already in use/ : /exited before readiness/);
            return true;
          });
      } finally { await stopNativeProgram(child); }
    }
  });
});

test('recovery cleans only recorded native auth directories and refuses an unidentified live fixture', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async (value) => {
    for (const kind of ['absent', 'outside', 'live']) {
      const id = runId();
      const directory = join(evidenceRoot, id);
      const authDirectory = kind === 'outside' ? join(value.directory, 'operator-auth') : join(temporaryRoot, 'acceptance-private', id, 'auth/native-auth-0');
      const storageRoot = join(directory, 'native-storage');
      const owner = `daynight-web-${id}`;
      await mkdir(authDirectory, { recursive: true });
      await mkdir(storageRoot, { recursive: true });
      await writeFile(join(authDirectory, 'apps.db'), 'owned private fixture database');
      const auth = { directory: authDirectory, binary: fileURLToPath(new URL('../../../daynight-server/.tmp/uniauth-fixture', import.meta.url)),
        binarySha256: 'a'.repeat(64), cleanup: 'pending', ...(kind === 'live' ? { processPid: process.pid } : {}) };
      await writeFile(join(directory, 'evidence.json'), JSON.stringify({ schemaVersion: 2, runId: id,
        source: { gitSha: sourceGitSha, githubSha: process.env.GITHUB_SHA ?? null },
        runner: { pid: 2_147_483_647, executable: process.execPath, startTicks: '1', group: 2_147_483_647 }, stages: [],
        native: { owner, postgresContainer: `${owner}-postgres`, postgresVolume: `${owner}-data`,
          binary: join(directory, 'daynight-server'), storageRoot, authFixtures: [auth] } }));
      await writeFile(join(value.bin, 'docker'), '#!/bin/sh\nexit 0\n');
      try {
        const result = await start([cli, '--cleanup', id], value).done;
        assert.equal(result.timedOut, false);
        if (kind === 'absent') {
          assert.equal(result.code, 0, result.stderr);
          await assert.rejects(readFile(join(authDirectory, 'apps.db')), { code: 'ENOENT' });
          const receipt = JSON.parse(await readFile(join(directory, 'recovery.json'), 'utf8')) as { authFixtures: unknown[]; result: string };
          assert.equal(receipt.result, 'passed');
          assert.deepEqual(receipt.authFixtures, [{ directory: authDirectory, result: 'not-started' }]);
        } else {
          assert.equal(result.code, 1);
          assert.match(result.stderr, kind === 'outside' ? /UniAuth fixture ownership differs/ : /Owned process lacks enough identity/);
          assert.equal(await readFile(join(authDirectory, 'apps.db'), 'utf8'), 'owned private fixture database');
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
        await rm(join(temporaryRoot, 'acceptance-private', id), { recursive: true, force: true });
      }
    }
  });
});
