import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as browserModule from './browser.mts';
import type { Browser } from '@playwright/test';

const root = fileURLToPath(new URL('../../.tmp/', import.meta.url));

test('browser ownership reads exact argv with a profile containing spaces', { skip: !['linux', 'darwin'].includes(process.platform) }, async () => {
  await mkdir(root, { recursive: true });
  const profile = await mkdtemp(join(root, 'playwright_chromiumdev_profile-spaces in '));
  const directory = await mkdtemp(join(root, 'browser-ownership-'));
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready");setInterval(()=>{},1000)', '--', `--user-data-dir=${profile}`], {
    detached: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
  try {
    await once(child.stdout!, 'data');
    const browser = { newBrowserCDPSession: async () => ({ send: async () => ({ processInfo: [{ type: 'browser', id: child.pid }] }), detach: async () => {} }) } as unknown as Browser;
    const owner = await browserModule.recordBrowserOwnership(browser, directory);
    assert.equal(owner.profile, profile);
    assert.deepEqual(JSON.parse(await readFile(join(profile, 'daynight-acceptance-owner.json'), 'utf8')), owner);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    await Promise.all([rm(profile, { recursive: true, force: true }), rm(directory, { recursive: true, force: true })]);
  }
});

test('browser inventory includes only exact executables from its macOS bundle', async () => {
  await mkdir(root, { recursive: true });
  const fixture = await mkdtemp(join(root, 'browser-bundle-'));
  const app = join(fixture, 'Google Chrome for Testing.app');
  const executable = join(app, 'Contents/MacOS/Google Chrome for Testing');
  const helpers = join(app, 'Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/151/Helpers');
  const expected = [executable, join(helpers, 'chrome_crashpad_handler'), ...['', ' (Renderer)', ' (GPU)', ' (Alerts)'].map((suffix) => join(helpers, `Google Chrome for Testing Helper${suffix}.app/Contents/MacOS/Google Chrome for Testing Helper${suffix}`))];
  const unrelated = join(fixture, 'Other Chrome.app/Contents/MacOS/Other Chrome');
  try {
    for (const path of [...expected, unrelated, join(helpers, 'app_mode_loader')]) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, '', { mode: 0o700 }); }
    assert.equal(typeof (browserModule as Record<string, unknown>).browserExecutables, 'function', 'bundle executable inventory API is required');
    const inventory = await (browserModule as typeof browserModule & { browserExecutables(path: string): Promise<string[]> }).browserExecutables(executable);
    assert.deepEqual(inventory.sort(), (await Promise.all(expected.map((path) => realpath(path)))).sort());
    assert.equal(inventory.some((path) => basename(path) === 'app_mode_loader'), false);
    assert.equal(inventory.includes(unrelated), false);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('pinned Chromium bundle processes recover using recorded ownership and preserve another browser', {
  skip: process.env.DAYNIGHT_TEST_PINNED_BROWSER !== '1', timeout: 45_000,
}, async () => {
  const { chromium } = await import('@playwright/test');
  const { findProcesses, processIdentity } = await import('./identity.mts');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'browser-native-'));
  const unrelatedDirectory = await mkdtemp(join(root, 'browser-unrelated-'));
  const profile = await mkdtemp(join(root, 'playwright_chromiumdev_profile-native spaces '));
  const otherProfile = await mkdtemp(join(root, 'playwright_chromiumdev_profile-other spaces '));
  const unrelated = await chromium.launchPersistentContext(otherProfile, { channel: 'chromium', headless: true, env: { ...process.env, DAYNIGHT_ACCEPTANCE_DIRECTORY: unrelatedDirectory } });
  let owned: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    const inventory = await browserModule.browserInventory();
    owned = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, env: { ...process.env, DAYNIGHT_ACCEPTANCE_DIRECTORY: directory } });
    await owned.newPage();
    const ownership = await browserModule.recordBrowserOwnership(owned.browser()!, directory);
    const unrelatedOwner = await browserModule.recordBrowserOwnership(unrelated.browser()!, unrelatedDirectory);
    const processes = await findProcesses({ DAYNIGHT_ACCEPTANCE_DIRECTORY: directory });
    assert.ok(processes.length > 1, 'native Chromium must expose its renderer/helper process');
    assert.ok(processes.every((process) => inventory.executables.includes(process.executable)), JSON.stringify(processes));
    if (process.platform === 'darwin') {
      assert.ok(ownership.companions.length > 0, 'macOS Crashpad has its own process group');
      const receipt = join(directory, 'browser-processes', `${ownership.identity.pid}-${ownership.identity.startTicks}.json`);
      await writeFile(receipt, JSON.stringify({ ...ownership, companions: [] }));
      await assert.rejects(browserModule.recoverBrowsers(directory, inventory), /Unrecorded Chromium startup process/);
      assert.ok(await processIdentity(ownership.identity.pid));
      assert.ok(await processIdentity(unrelatedOwner.identity.pid));
      await writeFile(receipt, JSON.stringify(ownership));
    }
    await browserModule.recoverBrowsers(directory, inventory);
    assert.equal(await processIdentity(ownership.identity.pid), null);
    await browserModule.recoverBrowsers(directory, inventory);
    await assert.rejects(readFile(join(profile, 'daynight-acceptance-owner.json')), { code: 'ENOENT' });
    assert.ok(await processIdentity(unrelatedOwner.identity.pid));
    assert.equal((await unrelated.newPage()).isClosed(), false);
  } finally {
    await Promise.all([owned?.close().catch(() => {}), unrelated.close()]);
    await Promise.all([directory, unrelatedDirectory, profile, otherProfile].map((path) => rm(path, { recursive: true, force: true })));
  }
});

test('normally closed pinned Chromium cleans its auto-created profile from the complete receipt', {
  skip: process.env.DAYNIGHT_TEST_PINNED_BROWSER !== '1', timeout: 30_000,
}, async () => {
  const { chromium } = await import('@playwright/test');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'browser-normal-close-'));
  const inventory = await browserModule.browserInventory();
  const previousTemporary = process.env.TMPDIR;
  let browser: Browser | undefined;
  let profile: string | undefined;
  try {
    process.env.TMPDIR = root;
    browser = await chromium.launch({ channel: 'chromium', headless: true, env: { ...process.env, DAYNIGHT_ACCEPTANCE_DIRECTORY: directory } });
    if (previousTemporary === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTemporary;
    const owner = await browserModule.recordBrowserOwnership(browser, directory);
    profile = owner.profile;
    await browser.close();
    await browserModule.recoverBrowsers(directory, inventory);
    await assert.rejects(readFile(join(profile, 'daynight-acceptance-owner.json')), { code: 'ENOENT' });
  } finally {
    if (previousTemporary === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTemporary;
    await browser?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
    if (profile !== undefined) await rm(profile, { recursive: true, force: true });
  }
});
