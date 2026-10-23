import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { storagePlatform } from './storage-platform.mts';
import { cleanupStorage, prepareStorage, verifyStorage, StoragePreparationError, type StorageReceipt } from './storage.mts';

const temporaryRoot = fileURLToPath(new URL('../../../../.tmp/', import.meta.url));
const owned = new Map<string, StorageReceipt>();
const exists = async (path: string): Promise<boolean> => {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};
const fixture = async (): Promise<string> => {
  await mkdir(temporaryRoot, { recursive: true });
  return await mkdtemp(join(temporaryRoot, 'acceptance-storage-test-'));
};
const planned = async (directory: string): Promise<StorageReceipt> => {
  let receipt: StorageReceipt | undefined;
  await assert.rejects(prepareStorage(directory, { persist: async (current) => {
    receipt = current;
    owned.set(current.directory, current);
    throw new Error('Stop after write-ahead persistence');
  } }), (error: unknown) => {
    assert.ok(error instanceof StoragePreparationError);
    assert.deepEqual(error.receipt, receipt);
    return /Stop after write-ahead persistence/.test(error.message);
  });
  assert.ok(receipt);
  return receipt;
};
const dispose = async (parent: string): Promise<void> => {
  for (const [directory, receipt] of owned) {
    if (!directory.startsWith(`${parent}/`)) continue;
    await cleanupStorage(receipt);
    owned.delete(directory);
  }
  await rm(parent, { recursive: true });
};

// The ordinary suite must fail before any change could request a mount authorization.
beforeEach((context) => {
  const execute = storagePlatform.execute;
  (context as TestContext).mock.method(storagePlatform, 'execute', async (command: string, args: string[], timeout: number, input?: string) => {
    if ((command === '/usr/bin/hdiutil' && ['create', 'attach'].includes(args[0]!))
      || (command === '/usr/sbin/diskutil' && args[0] === 'image' && args[1] === 'attach')) {
      throw new Error('The default storage suite must not create or attach disk images.');
    }
    return await execute(command, args, timeout, input);
  });
});

test('preparation journals a recoverable receipt before probing or allocating data', async () => {
  const parent = await fixture();
  try {
    const receipt = await planned(join(parent, 'storage'));
    const journal = JSON.parse(await readFile(join(receipt.directory, 'storage-receipt.json'), 'utf8')) as StorageReceipt;
    assert.deepEqual(journal, receipt);
    assert.equal(await exists(receipt.root), false);
    await cleanupStorage(journal);
    assert.equal(await exists(receipt.directory), false);
    await cleanupStorage(journal);
  } finally { await dispose(parent); }
});

test('preparation refuses an existing directory and preserves its contents', async () => {
  const parent = await fixture();
  try {
    await writeFile(join(parent, 'keep'), 'foreign');
    await assert.rejects(prepareStorage(parent), /exist/i);
    assert.equal(await readFile(join(parent, 'keep'), 'utf8'), 'foreign');
  } finally { await dispose(parent); }
});

test('receipt cleanup refuses a replaced directory and preserves foreign contents', async () => {
  const parent = await fixture();
  let receipt: StorageReceipt | undefined;
  let moved = false;
  try {
    receipt = await planned(join(parent, 'storage'));
    await rename(receipt.directory, `${receipt.directory}.saved`);
    moved = true;
    await mkdir(receipt.directory);
    await writeFile(join(receipt.directory, 'keep'), 'foreign');
    await assert.rejects(cleanupStorage(receipt), /identity|ownership|replaced/i);
    assert.equal(await readFile(join(receipt.directory, 'keep'), 'utf8'), 'foreign');
  } finally {
    if (moved) {
      await rm(receipt!.directory, { recursive: true });
      await rename(`${receipt!.directory}.saved`, receipt!.directory);
    }
    await dispose(parent);
  }
});

test('receipt cleanup rejects changed paths and cross-platform identity', async () => {
  const parent = await fixture();
  try {
    const receipt = await planned(join(parent, 'storage'));
    await assert.rejects(cleanupStorage({ ...receipt, root: parent }), /paths/i);
    await assert.rejects(cleanupStorage({ ...receipt, platform: receipt.platform === 'linux' ? 'darwin' : 'linux' }), /platform/i);
    assert.equal(await exists(receipt.directory), true);
  } finally { await dispose(parent); }
});

test('unsupported storage platforms fail before creating a directory', async (context) => {
  const parent = await fixture();
  const platform = context.mock.method(storagePlatform, 'platform', () => 'win32');
  try {
    await assert.rejects(prepareStorage(join(parent, 'storage')), /Unsupported.*win32/);
    assert.equal(await exists(join(parent, 'storage')), false);
  } finally { platform.mock.restore(); await dispose(parent); }
});

test('APFS attachment avoids help initialization and falls back only for an unsupported image verb', { skip: process.platform !== 'darwin' }, async (context) => {
  const parent = await fixture();
  try {
    await writeFile(join(parent, 'case-probe'), 'probe');
    if (!await exists(join(parent, 'CASE-PROBE'))) { context.skip('APFS fallback requires a case-insensitive task filesystem.'); return; }
    const unsupported = Object.assign(new Error('Unsupported image verb'), {
      code: 1, stderr: 'diskutil: did not recognize verb "image"; type "diskutil" for a list\n',
    });
    const failures = [
      Object.assign(new Error('Authorization denied'), { code: 1, stderr: 'Authorization denied' }),
      Object.assign(new Error('Attachment timed out'), { code: null, killed: true, stderr: '' }),
      Object.assign(new Error('Unknown image error'), { code: 1, stderr: 'did not recognize verb while opening image' }),
    ];
    for (const [index, failure] of [undefined, unsupported, ...failures].entries()) {
      const calls: { command: string; args: string[]; timeout: number }[] = [];
      const directory = join(parent, `storage-${index}`);
      const execution = context.mock.method(storagePlatform, 'execute', async (command: string, args: string[], timeout: number) => {
        calls.push({ command, args, timeout });
        if (command === '/usr/bin/hdiutil' && args[0] === 'create') { await writeFile(args.at(-1)!, 'fake image'); return ''; }
        if (command === '/usr/sbin/diskutil') {
          assert.deepEqual(args, ['image', 'attach', '--plist', '--mountOptions', 'nobrowse', '--mountPoint', join(directory, 'mount'), join(directory, 'storage.sparseimage')]);
          assert.equal(timeout, 30_000);
          if (failure !== undefined) throw failure;
          return 'fake attachment';
        }
        if (command === '/usr/bin/hdiutil' && args[0] === 'attach') {
          assert.equal(failure, unsupported);
          assert.deepEqual(args, ['attach', '-plist', '-nobrowse', '-noautoopen', '-mountpoint', join(directory, 'mount'), join(directory, 'storage.sparseimage')]);
          assert.equal(timeout, 30_000);
          return 'fake attachment';
        }
        if (command === '/usr/bin/plutil') throw new Error('Stop after simulated attachment');
        throw new Error(`Unexpected storage command: ${command}`);
      });
      try {
        await assert.rejects(prepareStorage(directory), (error: unknown) => {
          assert.ok(error instanceof StoragePreparationError);
          assert.equal(error.receipt.phase, 'attach-intent');
          if (failure !== undefined && failure !== unsupported) assert.equal(error.cause, failure);
          else assert.match(error.message, /Stop after simulated attachment/);
          return true;
        });
        assert.equal(calls.filter(({ command }) => command === '/usr/sbin/diskutil').length, 1);
        assert.equal(calls.filter(({ command, args }) => command === '/usr/bin/hdiutil' && args[0] === 'attach').length, failure === unsupported ? 1 : 0);
      } finally { execution.mock.restore(); }
    }
  } finally { await rm(parent, { recursive: true }); }
});

test('Linux direct storage preserves case-distinct files and removes its owned root', { skip: process.platform !== 'linux' }, async () => {
  const parent = await fixture();
  try {
    const receipt = await prepareStorage(join(parent, 'storage'), { persist: async (current) => { owned.set(current.directory, current); } });
    assert.equal(receipt.mode, 'directory');
    await writeFile(join(receipt.root, 'File'), 'upper');
    await writeFile(join(receipt.root, 'file'), 'lower');
    assert.equal(await readFile(join(receipt.root, 'File'), 'utf8'), 'upper');
    assert.equal(await readFile(join(receipt.root, 'file'), 'utf8'), 'lower');
    await cleanupStorage(receipt);
    assert.equal(await exists(receipt.directory), false);
  } finally { await dispose(parent); }
});

type SimulatedImage = { attached: boolean; device: string; detaches: number; now: number; timeouts: number[] };
const simulatedImage = async (context: TestContext, parent: string, detach: (image: SimulatedImage) => void): Promise<StorageReceipt> => {
  const initial = await planned(join(parent, 'storage'));
  const imageFile = join(initial.directory, 'storage.sparseimage');
  await writeFile(imageFile, 'owned image fixture');
  const file = await lstat(imageFile, { bigint: true });
  const receipt: StorageReceipt = { ...initial, platform: 'darwin', mode: 'apfs-image', phase: 'ready', imageFile,
    imageIdentity: { device: String(file.dev), inode: String(file.ino) }, mountDirectory: join(initial.directory, 'mount'),
    root: join(initial.directory, 'mount', 'data'), rootDevice: '/dev/disk404' };
  const image: SimulatedImage = { attached: true, device: '/dev/disk404', detaches: 0, now: 0, timeouts: [] };
  context.mock.method(storagePlatform, 'platform', () => 'darwin');
  context.mock.method(storagePlatform, 'now', () => image.now);
  context.mock.method(storagePlatform, 'delay', async (milliseconds: number) => { image.now += milliseconds; });
  context.mock.method(storagePlatform, 'execute', async (command: string, args: string[], timeout: number, input?: string) => {
    if (command === '/sbin/mount') return '/dev/disk0s1 on / (apfs, local)';
    if (command === '/usr/bin/hdiutil' && args[0] === 'info') return image.attached ? 'attached' : 'absent';
    if (command === '/usr/bin/plutil' && args[0] === '-extract') {
      if (args[1] === 'images') return input === 'attached' ? '1' : '0';
      if (args[1] === 'images.0.image-path') return imageFile;
      if (args[1] === 'images.0.system-entities') return JSON.stringify([
        { 'content-hint': 'GUID_partition_scheme', 'dev-entry': image.device },
        { 'content-hint': '7C3457EF-0000-11AA-AA11-00306543ECAC', 'dev-entry': `${image.device}s1` },
      ]);
    }
    if (command === '/usr/bin/hdiutil' && args[0] === 'detach') {
      assert.equal(args[1], '/dev/disk404');
      assert.equal(args.length, 2);
      image.detaches += 1;
      image.timeouts.push(timeout);
      detach(image);
      return '';
    }
    throw new Error(`Unexpected simulated storage command: ${command} ${args.join(' ')}`);
  });
  return receipt;
};
const busy = (): Error => Object.assign(new Error('Resource busy'), { stderr: 'hdiutil: Resource busy' });

test('APFS cleanup retries explicit busy errors and confirms absence before removing files', async (context) => {
  const parent = await fixture();
  let attempts = 0;
  try {
    const receipt = await simulatedImage(context, parent, (image) => {
      attempts += 1;
      if (image.detaches <= 4) throw busy();
      image.attached = false;
    });
    await cleanupStorage(receipt);
    assert.equal(attempts, 5);
    assert.equal(await exists(receipt.directory), false);
  } finally { context.mock.restoreAll(); await dispose(parent); }
});

test('APFS cleanup preserves files and does not retry other detach failures', async (context) => {
  const parent = await fixture();
  let attempts = 0;
  try {
    const receipt = await simulatedImage(context, parent, () => { attempts += 1; throw new Error('Device I/O error'); });
    await assert.rejects(cleanupStorage(receipt), /Device I\/O error/);
    assert.equal(attempts, 1);
    assert.equal(await readFile(receipt.imageFile!, 'utf8'), 'owned image fixture');
  } finally { context.mock.restoreAll(); await dispose(parent); }
});

test('APFS busy retry refuses changed device ownership before another detach', async (context) => {
  const parent = await fixture();
  let attempts = 0;
  try {
    const receipt = await simulatedImage(context, parent, (image) => {
      attempts += 1;
      image.device = '/dev/disk405';
      throw busy();
    });
    await assert.rejects(cleanupStorage(receipt), /device.*ownership|device.*changed/i);
    assert.equal(attempts, 1);
    assert.equal(await exists(receipt.imageFile!), true);
  } finally { context.mock.restoreAll(); await dispose(parent); }
});

test('APFS busy retry stops at its total deadline and preserves recovery files', async (context) => {
  const parent = await fixture();
  let attempts = 0;
  try {
    const receipt = await simulatedImage(context, parent, (image) => {
      attempts += 1;
      assert.ok(image.timeouts.at(-1)! <= 30_000);
      image.now = 30_000;
      throw busy();
    });
    await assert.rejects(cleanupStorage(receipt), /deadline|busy/i);
    assert.equal(attempts, 1);
    assert.equal(await exists(receipt.imageFile!), true);
  } finally { context.mock.restoreAll(); await dispose(parent); }
});

test('APFS busy retry checks the backing image inode again before another detach', async (context) => {
  const parent = await fixture();
  let attempts = 0;
  let imageFile: string | undefined;
  try {
    const receipt = await simulatedImage(context, parent, () => { attempts += 1; throw busy(); });
    imageFile = receipt.imageFile!;
    context.mock.method(storagePlatform, 'delay', async () => {
      await rename(imageFile!, `${imageFile}.saved`);
      await writeFile(imageFile!, 'foreign replacement');
    });
    await assert.rejects(cleanupStorage(receipt), /image.*identity|image.*replaced/i);
    assert.equal(attempts, 1);
    assert.equal(await readFile(imageFile, 'utf8'), 'foreign replacement');
  } finally {
    context.mock.restoreAll();
    if (imageFile !== undefined && await exists(`${imageFile}.saved`)) {
      await rm(imageFile);
      await rename(`${imageFile}.saved`, imageFile);
    }
    await dispose(parent);
  }
});

test('APFS cleanup spends its bounded busy retry budget while retaining recovery ownership', async (context) => {
  const parent = await fixture();
  let attempts = 0;
  let imageState: SimulatedImage | undefined;
  try {
    const receipt = await simulatedImage(context, parent, (image) => {
      imageState = image;
      attempts += 1;
      throw busy();
    });
    await assert.rejects(cleanupStorage(receipt), /deadline/i);
    assert.ok(attempts > 3);
    assert.equal(imageState!.now, 30_000);
    assert.ok(imageState!.timeouts.every((timeout, index, all) => timeout > 0 && timeout <= 30_000
      && (index === 0 || timeout < all[index - 1]!)));
    assert.equal(await exists(receipt.imageFile!), true);
  } finally { context.mock.restoreAll(); await dispose(parent); }
});

test('ready APFS verification requires the recorded mounted image without changing resources', async (context) => {
  const parent = await fixture();
  try {
    const receipt = await simulatedImage(context, parent, () => { throw new Error('Read verification must not detach storage.'); });
    await mkdir(receipt.root, { recursive: true });
    await writeFile(join(receipt.directory, 'storage-receipt.json'), JSON.stringify(receipt));
    const original = storagePlatform.execute;
    let attached = true;
    let mounted = true;
    let changedDevice = false;
    context.mock.method(storagePlatform, 'execute', async (command: string, args: string[], timeout: number, input?: string) => {
      if (command === '/usr/bin/hdiutil' && args[0] === 'info') return attached ? 'attached' : 'absent';
      if (command === '/sbin/mount') return mounted ? `/dev/disk404s1 on ${receipt.mountDirectory} (apfs, local)` : '/dev/disk0s1 on / (apfs, local)';
      if (command === '/usr/bin/plutil' && args[1] === 'images.0.system-entities') return JSON.stringify([
        { 'content-hint': 'GUID_partition_scheme', 'dev-entry': changedDevice ? '/dev/disk405' : '/dev/disk404' },
        { 'content-hint': '7C3457EF-0000-11AA-AA11-00306543ECAC', 'dev-entry': '/dev/disk404s1', 'mount-point': receipt.mountDirectory },
      ]);
      return await original(command, args, timeout, input);
    });
    await verifyStorage(receipt);
    attached = false;
    await assert.rejects(verifyStorage(receipt), /not attached/);
    attached = true; mounted = false;
    await assert.rejects(verifyStorage(receipt), /mount ownership/);
    mounted = true; changedDevice = true;
    await assert.rejects(verifyStorage(receipt), /not attached/);
    assert.equal(await exists(receipt.root), true);
  } finally { context.mock.restoreAll(); await dispose(parent); }
});
