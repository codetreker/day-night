import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { storagePlatform } from './storage-platform.mts';
import { cleanupStorage, prepareStorage, StoragePreparationError, type StorageReceipt } from './storage.mts';

const requested = process.env.DAYNIGHT_TEST_APFS === '1';
const reason = process.platform !== 'darwin' ? 'Native APFS storage requires macOS.'
  : !requested ? 'APFS native evidence was not requested; use the explicit test:storage-native command.' : false;
const temporaryRoot = fileURLToPath(new URL('../../../../.tmp/', import.meta.url));

const bounded = async <T,>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error(`${label} timed out.`)); }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
};

const startReadOnlyHolder = (file: string, cwd: string) => {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { openSync, closeSync } from 'node:fs';
    const descriptor = openSync(process.argv[1], 'r');
    process.once('message', (message) => {
      if (message !== 'release') throw new Error('Unexpected holder request.');
      closeSync(descriptor);
      process.send({ kind: 'released', pid: process.pid }, () => process.disconnect());
    });
    process.send({ kind: 'ready', pid: process.pid });
  `, file], { cwd, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const events = new EventEmitter();
  let stderr = '';
  let readyPid: number | undefined;
  let releasedAt: number | undefined;
  let failure: Error | undefined;
  let exited = false;
  child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.on('message', (value: unknown) => {
    const message = value as { kind?: unknown; pid?: unknown } | null;
    if (message === null || typeof message !== 'object' || message.pid !== child.pid
      || !['ready', 'released'].includes(String(message.kind))) failure = new Error('Unexpected file holder acknowledgement.');
    else if (message.kind === 'ready') readyPid = message.pid as number;
    else releasedAt = performance.now();
    events.emit('change');
  });
  child.once('error', (error) => { failure = error; events.emit('change'); });
  const closed = new Promise<void>((resolve) => {
    child.once('close', (code, signal) => {
      exited = true;
      if (code !== 0 || signal !== null) failure ??= new Error(`File holder exited with ${code}/${signal}: ${stderr}`);
      events.emit('change');
      resolve();
    });
  });
  const acknowledge = async (kind: 'ready' | 'released'): Promise<void> => {
    let check: (() => void) | undefined;
    try {
      await bounded(new Promise<void>((resolve, reject) => {
        check = () => {
          if (failure !== undefined) reject(failure);
          else if (kind === 'ready' ? readyPid !== undefined : releasedAt !== undefined) resolve();
          else if (exited) reject(new Error(`File holder exited before ${kind} acknowledgement: ${stderr}`));
        };
        events.on('change', check);
        check();
      }), 3_000, `File holder ${kind} acknowledgement`);
    } finally { if (check !== undefined) events.off('change', check); }
  };
  let releaseRequested = false;
  const release = (): void => {
    if (releaseRequested || exited || !child.connected) return;
    releaseRequested = true;
    child.send('release', (error) => {
      if (error !== null) { failure ??= error; events.emit('change'); }
    });
  };
  return {
    child, ready: () => acknowledge('ready'), readyPid: () => readyPid, releasedAt: () => releasedAt,
    finish: async (): Promise<void> => {
      release();
      try { await bounded(closed, 3_000, 'File holder exit'); }
      catch (error) {
        child.kill('SIGTERM');
        try { await bounded(closed, 2_000, 'Terminated file holder exit'); }
        catch (terminationError) {
          child.kill('SIGKILL');
          await bounded(closed, 2_000, 'Killed file holder exit');
          throw new AggregateError([error, terminationError], 'Owned file holder did not exit normally.', { cause: error });
        }
        throw error;
      }
      await acknowledge('released');
    },
  };
};

test('native APFS storage uses one shared mount for ownership and recovery scenarios', { skip: reason, timeout: 180_000 }, async (context) => {
  const execute = storagePlatform.execute;
  let creations = 0;
  let attachments = 0;
  context.mock.method(storagePlatform, 'execute', async (command: string, args: string[], timeout: number, input?: string) => {
    if (command === '/usr/bin/hdiutil' && args[0] === 'create' && ++creations > 1) throw new Error('Native storage scenarios must share one image.');
    const attaching = (command === '/usr/bin/hdiutil' && args[0] === 'attach')
      || (command === '/usr/sbin/diskutil' && args[0] === 'image' && args[1] === 'attach' && !args.includes('--help'));
    if (attaching && ++attachments > 1) throw new Error('Native storage scenarios must share one attachment.');
    return await execute(command, args, timeout, input);
  });
  await mkdir(temporaryRoot, { recursive: true });
  const parent = await mkdtemp(join(temporaryRoot, 'acceptance-storage-native-'));
  let receipt: StorageReceipt | undefined;
  let intent: StorageReceipt | undefined;
  try {
    const probe = join(parent, 'case-probe');
    await writeFile(probe, 'probe');
    let parentSensitive = false;
    try { await stat(join(parent, 'CASE-PROBE')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; parentSensitive = true; }
    finally { await rm(probe); }
    if (parentSensitive) { context.skip('The task filesystem is already case-sensitive; APFS fallback was not exercised.'); return; }

    await assert.rejects(prepareStorage(join(parent, 'storage'), { persist: async (current) => {
      if (current.phase === 'attach-intent') {
        intent = structuredClone(current);
        assert.ok(current.imageIdentity);
        assert.equal((await stat(current.mountDirectory!)).dev, (await stat(parent)).dev);
      }
      if (current.phase === 'ready') throw new Error('Ready persistence failed after attachment');
    } }), (error: unknown) => {
      assert.ok(error instanceof StoragePreparationError);
      receipt = error.receipt;
      return /Ready persistence failed after attachment/.test(error.message);
    });
    assert.ok(receipt);
    assert.ok(intent);
    const current = receipt;

    await context.test('write-ahead and ready journals recover a mounted case-sensitive filesystem', async () => {
      assert.equal(current.mode, 'apfs-image');
      assert.notEqual((await stat(current.root)).dev, (await stat(parent)).dev);
      assert.deepEqual(JSON.parse(await readFile(join(current.directory, 'storage-receipt.json'), 'utf8')), current);
      await writeFile(join(current.root, 'File'), 'upper');
      await writeFile(join(current.root, 'file'), 'lower');
      assert.equal(await readFile(join(current.root, 'File'), 'utf8'), 'upper');
      assert.equal(await readFile(join(current.root, 'file'), 'utf8'), 'lower');
    });

    await context.test('a case-sensitive parent uses a direct directory without another attachment', async () => {
      let inner: StorageReceipt | undefined;
      try {
        inner = await prepareStorage(join(current.root, 'inner'));
        assert.equal(inner.mode, 'directory');
        await writeFile(join(inner.root, 'File'), 'upper');
        await writeFile(join(inner.root, 'file'), 'lower');
        assert.equal(await readFile(join(inner.root, 'File'), 'utf8'), 'upper');
        assert.equal(await readFile(join(inner.root, 'file'), 'utf8'), 'lower');
      } catch (error) {
        if (error instanceof StoragePreparationError) inner = error.receipt;
        throw error;
      } finally { if (inner !== undefined) await cleanupStorage(inner); }
    });

    await context.test('cleanup refuses changed device or image identity and any unowned mount', async () => {
      await assert.rejects(cleanupStorage({ ...current, imageIdentity: { device: '0', inode: '0' } }), /image.*identity|image.*replaced/i);
      await assert.rejects(cleanupStorage({ ...current, rootDevice: '/dev/disk999999' }), /device.*changed|device.*ownership/i);
      const direct: StorageReceipt = { schemaVersion: 1, platform: 'darwin', directory: current.directory,
        directoryIdentity: current.directoryIdentity, mode: 'directory', phase: 'planned', root: join(current.directory, 'data') };
      await assert.rejects(cleanupStorage(direct), /mount/i);
      assert.equal(await readFile(join(current.root, 'File'), 'utf8'), 'upper');
    });

    await context.test('cleanup preserves a replacement backing file', async () => {
      const imageFile = current.imageFile!;
      await rename(imageFile, `${imageFile}.saved`);
      try {
        await writeFile(imageFile, 'foreign image', { flag: 'wx' });
        await assert.rejects(cleanupStorage(current), /image.*identity|image.*replaced/i);
        assert.equal(await readFile(imageFile, 'utf8'), 'foreign image');
      } finally {
        await rm(imageFile, { force: true });
        await rename(`${imageFile}.saved`, imageFile);
      }
    });

    await context.test('a missing control path cannot hide its still-attached image', async () => {
      await rename(current.directory, `${current.directory}.saved`);
      try { await assert.rejects(cleanupStorage(current), /attached|directory.*missing|directory.*unavailable/i); }
      finally { await rename(`${current.directory}.saved`, current.directory); }
    });

    await context.test('the pre-attachment receipt recovers after a real read-only holder releases', { timeout: 45_000 }, async (busyContext) => {
      const holder = startReadOnlyHolder(join(current.root, 'File'), parent);
      const guardedExecute = storagePlatform.execute;
      const detachEvents: { startedAt: number; finishedAt: number; result: 'busy' | 'success' | 'failure'; stderr?: string }[] = [];
      let holderInventory: string | undefined;
      let firstBusyAt: number | undefined;
      let cleanupStartedAt: number | undefined;
      let cleanupFinishedAt: number | undefined;
      let originalError: unknown;
      const observation = busyContext.mock.method(storagePlatform, 'execute', async (command: string, args: string[], timeout: number, input?: string) => {
        if (command !== '/usr/bin/hdiutil' || args[0] !== 'detach') return await guardedExecute(command, args, timeout, input);
        assert.deepEqual(args, ['detach', current.rootDevice]);
        const startedAt = performance.now();
        try {
          const result = await guardedExecute(command, args, timeout, input);
          detachEvents.push({ startedAt, finishedAt: performance.now(), result: 'success' });
          return result;
        } catch (error) {
          const stderr = (error as { stderr?: unknown }).stderr;
          const busy = typeof stderr === 'string' && /\bResource busy\b/.test(stderr);
          const finishedAt = performance.now();
          detachEvents.push({ startedAt, finishedAt, result: busy ? 'busy' : 'failure', ...(typeof stderr === 'string' ? { stderr } : {}) });
          if (busy && firstBusyAt === undefined) {
            firstBusyAt = finishedAt;
            holderInventory = await guardedExecute('/usr/sbin/lsof', ['-nP', '-Fpcfatn', '-a', '-p', String(holder.child.pid), '+f', '--', current.mountDirectory!], 2_000);
            assert.ok(holderInventory.split('\n').includes(`p${holder.child.pid}`));
            assert.match(holderInventory, /^f\d+$/m);
            assert.match(holderInventory, /^ar$/m);
            assert.ok(holderInventory.split('\n').includes(`n${join(current.root, 'File')}`));
            await holder.finish();
          }
          throw error;
        }
      });
      try {
        await holder.ready();
        assert.equal(holder.readyPid(), holder.child.pid);
        assert.equal(holder.child.exitCode, null);
        cleanupStartedAt = performance.now();
        await cleanupStorage(intent!);
        cleanupFinishedAt = performance.now();
        assert.equal(detachEvents[0]?.result, 'busy');
        assert.equal(detachEvents.at(-1)?.result, 'success');
        assert.ok(detachEvents.length >= 2);
        assert.ok(holder.releasedAt()! >= firstBusyAt!);
        assert.equal(holder.child.exitCode, 0);
        assert.ok(cleanupFinishedAt - cleanupStartedAt < 30_000);
        await assert.rejects(stat(current.directory), { code: 'ENOENT' });
        await cleanupStorage(current);
      } catch (error) { originalError = error; }
      finally {
        observation.mock.restore();
        try { await holder.finish(); }
        catch (cleanupError) {
          if (originalError !== undefined) throw new AggregateError([originalError, cleanupError], 'APFS holder recovery and owned child cleanup failed.', { cause: originalError });
          throw cleanupError;
        } finally {
          process.stderr.write(`APFS storage holder recovery: ${JSON.stringify({ holderPid: holder.child.pid, readyPid: holder.readyPid(),
            firstBusyAt, releasedAt: holder.releasedAt(), detachEvents, holderInventory,
            cleanupStartedAt, cleanupFinishedAt, holderExitCode: holder.child.exitCode })}\n`);
        }
      }
      if (originalError !== undefined) throw originalError;
    });
    assert.equal(creations, 1);
    assert.equal(attachments, 1);
  } finally {
    if (receipt !== undefined) await cleanupStorage(receipt);
    await rm(parent, { recursive: true });
  }
});
