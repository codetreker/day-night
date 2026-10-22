import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { storagePlatform } from './storage-platform.mts';

export type FileIdentity = { device: string; inode: string };
export type StorageReceipt = {
  schemaVersion: 1;
  platform: 'linux' | 'darwin';
  directory: string;
  directoryIdentity: FileIdentity;
  root: string;
  mode: 'directory' | 'apfs-image';
  phase: 'planned' | 'image-created' | 'attach-intent' | 'ready';
  imageFile?: string;
  imageIdentity?: FileIdentity;
  mountDirectory?: string;
  rootDevice?: string;
};
export type StorageOptions = { persist?: (receipt: StorageReceipt) => Promise<void> };
type Entity = { device: string; mountPoint?: string };
type Image = { rootDevice: string; entities: Entity[] };
type Mount = { source: string; directory: string };
const devicePattern = /^\/dev\/disk\d+(?:s\d+)*$/;

export class StoragePreparationError extends Error {
  readonly receipt: StorageReceipt;
  constructor(receipt: StorageReceipt, cause: unknown) {
    super(`Storage preparation failed: ${cause instanceof Error ? cause.message : String(cause)}. Recover with ${join(receipt.directory, 'storage-receipt.json')}.`, { cause });
    this.name = 'StoragePreparationError';
    this.receipt = structuredClone(receipt);
  }
}

const absent = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';
const identity = async (path: string, directory: boolean): Promise<FileIdentity> => {
  const entry = await lstat(path, { bigint: true });
  if (entry.isSymbolicLink() || (directory ? !entry.isDirectory() : !entry.isFile())) throw new Error(`Storage ${path} has an unexpected file type.`);
  return { device: String(entry.dev), inode: String(entry.ino) };
};
const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean => left.device === right.device && left.inode === right.inode;
const verifyIdentity = async (path: string, expected: FileIdentity, directory: boolean, label: string): Promise<void> => {
  if (await realpath(path) !== path || !sameIdentity(await identity(path, directory), expected)) throw new Error(`Storage ${label} identity changed or was replaced: ${path}.`);
};
const validIdentity = (value: unknown): value is FileIdentity => {
  const object = value as Partial<FileIdentity> | null;
  return object !== null && typeof object === 'object' && typeof object.device === 'string' && /^\d+$/.test(object.device)
    && typeof object.inode === 'string' && /^\d+$/.test(object.inode);
};
const validateReceipt = (receipt: StorageReceipt): void => {
  if (receipt.schemaVersion !== 1 || !['linux', 'darwin'].includes(receipt.platform) || receipt.platform !== storagePlatform.platform()
    || typeof receipt.directory !== 'string' || !isAbsolute(receipt.directory) || resolve(receipt.directory) !== receipt.directory
    || receipt.directory === sep || !validIdentity(receipt.directoryIdentity)
    || !['planned', 'image-created', 'attach-intent', 'ready'].includes(receipt.phase)) throw new Error('Invalid storage receipt identity or platform.');
  if (receipt.mode === 'directory') {
    if (receipt.root !== join(receipt.directory, 'data') || !['planned', 'ready'].includes(receipt.phase)
      || receipt.imageFile !== undefined || receipt.imageIdentity !== undefined || receipt.mountDirectory !== undefined || receipt.rootDevice !== undefined) {
      throw new Error('Invalid direct storage receipt paths.');
    }
  } else if (receipt.mode === 'apfs-image') {
    if (receipt.platform !== 'darwin' || receipt.mountDirectory !== join(receipt.directory, 'mount')
      || receipt.imageFile !== join(receipt.directory, 'storage.sparseimage') || receipt.root !== join(receipt.mountDirectory, 'data')
      || (receipt.phase !== 'planned' && !validIdentity(receipt.imageIdentity))
      || (receipt.imageIdentity !== undefined && !validIdentity(receipt.imageIdentity))
      || (receipt.rootDevice !== undefined && !devicePattern.test(receipt.rootDevice))
      || (receipt.phase === 'ready' && receipt.rootDevice === undefined)) throw new Error('Invalid APFS storage receipt paths or image identity.');
  } else throw new Error('Invalid storage receipt mode.');
};
const execute = async (command: string, args: string[], timeout: number, input?: string, deadline?: number): Promise<string> => {
  const remaining = Math.floor(deadline === undefined ? timeout : Math.min(timeout, deadline - storagePlatform.now()));
  if (remaining < 1) throw new Error('Storage cleanup deadline reached; resources have been preserved.');
  return await storagePlatform.execute(command, args, remaining, input);
};
const extract = async (plist: string, key: string, format: 'raw' | 'json', type: 'array' | 'string', deadline?: number): Promise<string> =>
  await execute('/usr/bin/plutil', ['-extract', key, format, '-expect', type, ...(format === 'raw' ? ['-n'] : []), '-o', '-', '-'], 2_000, plist, deadline);
const attachImage = async (imageFile: string, mountDirectory: string): Promise<string> => {
  try { await execute('/usr/sbin/diskutil', ['image', 'attach', '--help'], 5_000); }
  catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr !== 'string' || !/did not recognize verb.*image/i.test(stderr)) throw error;
    return await execute('/usr/bin/hdiutil', ['attach', '-plist', '-nobrowse', '-noautoopen', '-mountpoint', mountDirectory, imageFile], 30_000);
  }
  // Current macOS directs custom mount points through diskutil's image API.
  return await execute('/usr/sbin/diskutil', ['image', 'attach', '--plist', '--mountOptions', 'nobrowse', '--mountPoint', mountDirectory, imageFile], 30_000);
};
const canonicalDevice = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Invalid APFS image device.');
  const device = value.startsWith('/dev/') ? value : `/dev/${value}`;
  if (!devicePattern.test(device)) throw new Error('Invalid APFS image device.');
  return device;
};
const topology = (value: unknown): Image => {
  if (!Array.isArray(value) || value.some((entry) => entry === null || typeof entry !== 'object' || Array.isArray(entry))) throw new Error('Invalid APFS image entities.');
  const entries = value as Record<string, unknown>[];
  const roots = entries.filter((entry) => entry['content-hint'] === 'GUID_partition_scheme');
  if (roots.length !== 1) throw new Error('APFS image has no unique GPT device.');
  const rootDevice = canonicalDevice(roots[0]!['dev-entry']);
  const entities = entries.map((entry): Entity => {
    const device = canonicalDevice(entry['dev-entry']);
    const mountPoint = entry['mount-point'];
    if (mountPoint !== undefined && (typeof mountPoint !== 'string' || !isAbsolute(mountPoint))) throw new Error('Invalid APFS image mount point.');
    return { device, ...(mountPoint === undefined ? {} : { mountPoint: mountPoint as string }) };
  });
  if (new Set(entities.map((entry) => entry.device)).size !== entities.length) throw new Error('Duplicate APFS image device.');
  return { rootDevice, entities };
};
const imageInventory = async (imageFile: string, movedIdentity?: FileIdentity, deadline?: number): Promise<Image | undefined> => {
  const plist = await execute('/usr/bin/hdiutil', ['info', '-plist'], 5_000, undefined, deadline);
  // Extract identity fields rather than converting unrelated binary image aliases to JSON.
  const count = await extract(plist, 'images', 'raw', 'array', deadline);
  if (!/^(0|[1-9]\d*)$/.test(count) || !Number.isSafeInteger(Number(count)) || Number(count) > 256) throw new Error('Invalid or excessive APFS image inventory.');
  let found: Image | undefined;
  for (let index = 0; index < Number(count); index += 1) {
    const path = await extract(plist, `images.${index}.image-path`, 'raw', 'string', deadline);
    let matches = path === imageFile;
    if (!matches) {
      try {
        matches = await realpath(path) === imageFile || (movedIdentity !== undefined && sameIdentity(await identity(path, false), movedIdentity));
      } catch (error) { if (!absent(error)) throw error; }
    }
    if (!matches) continue;
    if (found !== undefined) throw new Error('Storage image appears more than once in the APFS image inventory.');
    found = topology(JSON.parse(await extract(plist, `images.${index}.system-entities`, 'json', 'array', deadline)) as unknown);
  }
  return found;
};
const mountInventory = async (deadline?: number): Promise<Mount[]> => {
  if (storagePlatform.platform() === 'linux') {
    const unescape = (value: string): string => value.replace(/\\(040|011|012|134)/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
    return (await readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').map((line) => {
      const fields = line.split(' ');
      const separator = fields.indexOf('-');
      if (separator < 6 || fields[4] === undefined || fields[separator + 2] === undefined) throw new Error('Invalid Linux mount inventory.');
      return { directory: unescape(fields[4]), source: unescape(fields[separator + 2]!) };
    });
  }
  return (await execute('/sbin/mount', [], 5_000, undefined, deadline)).trim().split('\n').map((line) => {
    const match = /^(.*?) on (\/.*) \([^\n]*\)$/.exec(line);
    if (match === null || line.split(' on ').length !== 2) throw new Error('Ambiguous macOS mount inventory; storage cleanup refused.');
    return { source: match[1]!, directory: match[2]! };
  });
};
const below = (path: string, directory: string): boolean => path === directory || path.startsWith(`${directory}${sep}`);
const verifyMounts = async (receipt: StorageReceipt, image?: Image, deadline?: number): Promise<void> => {
  const mounts = (await mountInventory(deadline)).filter((mount) => below(mount.directory, receipt.directory));
  for (const mount of mounts) {
    const owned = image?.entities.some((entity) => entity.device === mount.source && entity.mountPoint === mount.directory);
    if (mount.directory !== receipt.mountDirectory || !owned) throw new Error(`Foreign or replaced mount beneath storage directory: ${mount.directory}.`);
  }
  if (image !== undefined) {
    for (const entity of image.entities) {
      if (entity.mountPoint !== undefined && (entity.mountPoint !== receipt.mountDirectory || !mounts.some((mount) => mount.directory === entity.mountPoint && mount.source === entity.device))) {
        throw new Error('APFS image mount ownership differs from the storage receipt.');
      }
    }
  }
};
const caseSensitive = async (directory: string): Promise<boolean> => {
  const name = `case-probe-${randomUUID()}`;
  const path = join(directory, name);
  await writeFile(path, 'probe', { flag: 'wx' });
  try { await lstat(join(directory, name.toUpperCase())); return false; }
  catch (error) { if (absent(error)) return true; throw error; }
  finally { await rm(path); }
};

/**
 * Own a new directory, using an APFS image only when its filesystem folds case.
 * Each transition is atomically journaled and passed to persist before attachment.
 * On failure the journal and StoragePreparationError.receipt permit explicit recovery.
 */
export async function prepareStorage(directory: string, options: StorageOptions = {}): Promise<StorageReceipt> {
  const platform = storagePlatform.platform();
  if (platform !== 'linux' && platform !== 'darwin') throw new Error(`Unsupported acceptance storage platform: ${platform}.`);
  const requested = resolve(directory);
  const canonical = join(await realpath(dirname(requested)), basename(requested));
  await mkdir(canonical);
  let receipt: StorageReceipt = {
    schemaVersion: 1, platform, directory: canonical, directoryIdentity: await identity(canonical, true),
    root: join(canonical, 'data'), mode: 'directory', phase: 'planned',
  };
  const persist = async (): Promise<void> => {
    const temporary = join(canonical, 'storage-receipt.json.tmp');
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', flush: true });
    await rename(temporary, join(canonical, 'storage-receipt.json'));
    await options.persist?.(structuredClone(receipt));
  };
  try {
    await persist();
    if (!await caseSensitive(canonical)) {
      if (platform !== 'darwin') throw new Error('Acceptance storage requires a case-sensitive filesystem.');
      receipt = { ...receipt, mode: 'apfs-image', mountDirectory: join(canonical, 'mount'),
        imageFile: join(canonical, 'storage.sparseimage'), root: join(canonical, 'mount', 'data') };
      await persist();
    }
    if (receipt.mode === 'apfs-image') {
      await mkdir(receipt.mountDirectory!);
      await execute('/usr/bin/hdiutil', ['create', '-size', '2g', '-type', 'SPARSE', '-layout', 'GPTSPUD', '-fs', 'Case-sensitive APFS',
        '-volname', `Daynight-${randomUUID()}`, '-quiet', receipt.imageFile!], 60_000);
      receipt = { ...receipt, phase: 'image-created', imageIdentity: await identity(receipt.imageFile!, false) };
      await persist();
      receipt = { ...receipt, phase: 'attach-intent' };
      await persist();
      const attachment = await attachImage(receipt.imageFile!, receipt.mountDirectory!);
      const attached = topology(JSON.parse(await extract(attachment, 'system-entities', 'json', 'array')) as unknown);
      await verifyIdentity(receipt.imageFile!, receipt.imageIdentity!, false, 'image');
      const current = await imageInventory(receipt.imageFile!);
      if (current === undefined || current.rootDevice !== attached.rootDevice) throw new Error('Attached APFS image device is not visible in its exact image inventory.');
      if (current.entities.filter((entity) => entity.mountPoint !== undefined).length !== 1
        || !current.entities.some((entity) => entity.mountPoint === receipt.mountDirectory)) throw new Error('APFS storage image was not mounted at its owned mount point.');
      await verifyMounts(receipt, current);
      receipt = { ...receipt, rootDevice: current.rootDevice };
      if (!await caseSensitive(receipt.mountDirectory!)) throw new Error('APFS storage image is not case-sensitive.');
    }
    await mkdir(receipt.root);
    receipt = { ...receipt, phase: 'ready' };
    await persist();
    return receipt;
  } catch (cause) { throw new StoragePreparationError(receipt, cause); }
}

/** Call only after all server and browser processes using storage have stopped. */
export async function cleanupStorage(receipt: StorageReceipt): Promise<void> {
  validateReceipt(receipt);
  const deadline = storagePlatform.now() + 30_000;
  try { await verifyIdentity(receipt.directory, receipt.directoryIdentity, true, 'directory'); }
  catch (error) {
    if (!absent(error)) throw error;
    if (receipt.mode === 'apfs-image' && await imageInventory(receipt.imageFile!, receipt.imageIdentity, deadline) !== undefined) {
      throw new Error('Storage directory is unavailable while its APFS image remains attached. Restore its owned paths before recovery.');
    }
    await verifyMounts(receipt, undefined, deadline);
    return;
  }
  if (receipt.mode === 'apfs-image') {
    const imageFile = receipt.imageFile!;
    if (receipt.imageIdentity !== undefined) await verifyIdentity(imageFile, receipt.imageIdentity, false, 'image');
    const current = await imageInventory(imageFile, undefined, deadline);
    if (current !== undefined) {
      if (receipt.imageIdentity === undefined) throw new Error('Cannot recover an APFS image without its persisted file identity.');
      if (receipt.rootDevice !== undefined && current.rootDevice !== receipt.rootDevice) throw new Error('APFS image device ownership changed.');
      const rootDevice = current.rootDevice;
      for (;;) {
        // Device numbers may be reused between attempts. Re-establish every ownership check.
        await verifyIdentity(receipt.directory, receipt.directoryIdentity, true, 'directory');
        await verifyIdentity(imageFile, receipt.imageIdentity, false, 'image');
        const observed = await imageInventory(imageFile, undefined, deadline);
        if (observed === undefined) break;
        if (observed.rootDevice !== rootDevice) throw new Error('APFS image device ownership changed during cleanup.');
        await verifyMounts(receipt, observed, deadline);
        try {
          // A failed attach can leave an unmounted device. Exact image identity still owns it.
          await execute('/usr/bin/hdiutil', ['detach', rootDevice], 30_000, undefined, deadline);
        } catch (error) {
          const stderr = (error as { stderr?: unknown }).stderr;
          if (typeof stderr !== 'string' || !/\bResource busy\b/.test(stderr)) throw error;
          const remaining = deadline - storagePlatform.now();
          if (remaining <= 0) throw new Error('APFS image is still busy at its cleanup deadline. Recovery files have been preserved.', { cause: error });
          // Transient volume users can outlast a few attempts; the shared deadline bounds retries.
          await storagePlatform.delay(Math.min(1_000, remaining));
          continue;
        }
        if (await imageInventory(imageFile, undefined, deadline) !== undefined) throw new Error('APFS image is still attached after detach. Storage has been preserved.');
        break;
      }
    }
  }
  await verifyMounts(receipt, undefined, deadline);
  await verifyIdentity(receipt.directory, receipt.directoryIdentity, true, 'directory');
  await rm(receipt.directory, { recursive: true });
}
