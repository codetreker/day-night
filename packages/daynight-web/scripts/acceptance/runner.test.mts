import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { processIdentity } from './identity.mts';

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
  } finally { await rm(directory, { recursive: true, force: true }); }
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
