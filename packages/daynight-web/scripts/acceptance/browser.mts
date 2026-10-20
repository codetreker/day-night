import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownedBrowserProcesses, processIdentity, requireGroupStopped, sameProcess, type ProcessIdentity } from './identity.mts';
import type { Browser } from '@playwright/test';

export type BrowserOwnership = { directory: string; identity: ProcessIdentity; profile: string };
export type BrowserInventory = { executables: string[]; profilesBefore: string[] };
const temporaryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)), '.tmp');
const profiles = async (): Promise<string[]> => (await readdir(temporaryRoot))
  .filter((entry) => entry.startsWith('playwright_chromiumdev_profile-')).map((entry) => join(temporaryRoot, entry));

export const recordBrowserOwnership = async (browser: Browser, directory: string): Promise<BrowserOwnership> => {
  const session = await browser.newBrowserCDPSession();
  const processes = await session.send('SystemInfo.getProcessInfo');
  await session.detach();
  const browserPid = processes.processInfo.find((process) => process.type === 'browser')?.id;
  if (browserPid === undefined) throw new Error('Chromium did not expose its operating-system process identity.');
  const identity = await processIdentity(browserPid);
  if (identity === null || identity.group !== identity.pid) throw new Error('Chromium browser group identity is not isolated.');
  const commandLine = (await readFile(`/proc/${identity.pid}/cmdline`)).toString();
  const escapedRoot = temporaryRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const argument = new RegExp(`(?:^|[ \\0])--user-data-dir=((?:${escapedRoot}|\\.tmp)/playwright_chromiumdev_profile-[a-zA-Z0-9_-]+)(?:[ \\0]|$)`).exec(commandLine);
  if (argument?.[1] === undefined) throw new Error('Chromium profile identity is missing.');
  const profile = resolve(argument[1]);
  if (dirname(profile) !== temporaryRoot || !profile.startsWith(join(temporaryRoot, 'playwright_chromiumdev_profile-'))) throw new Error('Chromium profile is outside the owned temporary directory.');
  const owner = { directory, identity, profile };
  await writeFile(join(profile, 'daynight-acceptance-owner.json'), `${JSON.stringify(owner)}\n`);
  await mkdir(join(directory, 'browser-processes'), { recursive: true });
  await writeFile(join(directory, 'browser-processes', `${identity.pid}-${identity.startTicks}.json`), `${JSON.stringify(owner)}\n`);
  return owner;
};

export const browserInventory = async (): Promise<BrowserInventory> => {
  const testRequire = createRequire(import.meta.resolve('@playwright/test'));
  const playwrightRequire = createRequire(testRequire.resolve('playwright'));
  const registry = (playwrightRequire('playwright-core/lib/coreBundle') as {
    registry: { registry: { findExecutable(name: string): { executablePath(): string } } };
  }).registry.registry;
  const executablePaths = process.env.DAYNIGHT_BROWSER_EXECUTABLE === undefined
    ? ['chromium', 'chromium-headless-shell'].map((name) => registry.findExecutable(name).executablePath())
    : [process.env.DAYNIGHT_BROWSER_EXECUTABLE];
  const executables = await Promise.all(executablePaths.map((path) => realpath(path)));
  for (const path of [...executables]) {
    try { executables.push(await realpath(join(dirname(path), 'chrome_crashpad_handler'))); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  return { executables: [...new Set(executables)], profilesBefore: await profiles() };
};

const pause = async (): Promise<void> => { await new Promise((done) => setTimeout(done, 100)); };

export const recoverBrowsers = async (directory: string, inventory: BrowserInventory): Promise<void> => {
  if (!Array.isArray(inventory.executables) || inventory.executables.length === 0
    || inventory.executables.some((path) => typeof path !== 'string' || !path.startsWith('/'))
    || !Array.isArray(inventory.profilesBefore)) throw new Error('Invalid browser inventory for recovery.');
  const records: BrowserOwnership[] = [];
  try {
    for (const name of await readdir(join(directory, 'browser-processes'))) {
      if (!/^\d+-\d+\.json$/.test(name)) throw new Error('Invalid browser process receipt.');
      records.push(JSON.parse(await readFile(join(directory, 'browser-processes', name), 'utf8')) as BrowserOwnership);
    }
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const observed = await ownedBrowserProcesses(directory, inventory.executables);
  const groups = new Set(records.map((record) => record.identity.group));
  if (observed.some((process) => !groups.has(process.group))) throw new Error('Unrecorded Chromium startup process remains; recovery ownership is uncertain.');
  for (const record of records) {
    const identity = record.identity;
    if (record.directory !== directory || identity.group !== identity.pid || !Number.isSafeInteger(identity.pid) || identity.pid <= 1
      || !inventory.executables.includes(identity.executable) || !/^\d+$/.test(identity.startTicks)
      || dirname(record.profile) !== temporaryRoot || !record.profile.startsWith(join(temporaryRoot, 'playwright_chromiumdev_profile-'))) {
      throw new Error('Browser recovery receipt ownership differs from this run.');
    }
    let marker: BrowserOwnership | undefined;
    try { marker = JSON.parse(await readFile(join(record.profile, 'daynight-acceptance-owner.json'), 'utf8')) as BrowserOwnership; }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    const active = await processIdentity(identity.pid);
    const members = observed.filter((process) => process.group === identity.group);
    if (active !== null && active.startTicks === identity.startTicks && !sameProcess(identity, active)) throw new Error('Browser executable changed during recovery.');
    if (members.length > 0) {
      if (marker === undefined || marker.directory !== directory || marker.profile !== record.profile
        || !sameProcess(identity, marker.identity)) throw new Error('Active browser profile lacks its ownership marker.');
      // A live leader is required before signaling its detached group; orphan-only groups remain uncertain.
      if (!sameProcess(identity, active)) throw new Error('Browser group leader is absent; refusing uncertain group recovery.');
      const membersNow = await ownedBrowserProcesses(directory, inventory.executables);
      if (members.some((member) => !membersNow.some((current) => sameProcess(member, current)))) throw new Error('Browser process identities changed during recovery.');
      process.kill(-identity.group, 'SIGTERM');
      let deadline = Date.now() + 10_000;
      while ((await ownedBrowserProcesses(directory, inventory.executables)).some((process) => process.group === identity.group) && Date.now() < deadline) await pause();
      const remaining = (await ownedBrowserProcesses(directory, inventory.executables)).filter((process) => process.group === identity.group);
      if (remaining.length > 0) {
        for (const process of remaining) {
          if (!sameProcess(process, await processIdentity(process.pid))) throw new Error('Chromium process changed before forced recovery.');
          globalThis.process.kill(process.pid, 'SIGKILL');
        }
        deadline = Date.now() + 5_000;
        while ((await ownedBrowserProcesses(directory, inventory.executables)).some((process) => process.group === identity.group) && Date.now() < deadline) await pause();
      }
    }
    requireGroupStopped(identity.group);
    if (marker !== undefined) {
      if (marker.directory !== directory || marker.profile !== record.profile || !sameProcess(identity, marker.identity)) throw new Error('Browser profile marker changed before cleanup.');
      await rm(record.profile, { recursive: true });
    }
  }
  if ((await ownedBrowserProcesses(directory, inventory.executables)).length > 0) throw new Error('Owned Chromium processes remain after recovery.');
  const known = new Set(records.map((record) => record.profile));
  if ((await profiles()).some((profile) => !inventory.profilesBefore.includes(profile) && !known.has(profile))) {
    throw new Error('Unrecorded Chromium profile remains from a startup window; recovery ownership is uncertain.');
  }
  for (const profile of known) {
    if ((await profiles()).includes(profile)) throw new Error('Owned Chromium profile remains after recovery.');
  }
};
