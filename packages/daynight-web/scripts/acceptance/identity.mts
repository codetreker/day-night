import { readFile, readlink, readdir } from 'node:fs/promises';

export type ProcessIdentity = { pid: number; executable: string; startTicks: string; group: number };

export const processIdentity = async (pid: number): Promise<ProcessIdentity | null> => {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid acceptance process identity.');
  if (process.platform !== 'linux') throw new Error('Process recovery requires Linux process identity support.');
  try {
    const executable = await readlink(`/proc/${pid}/exe`);
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const startTicks = fields[19];
    const group = Number(fields[2]);
    if (startTicks === undefined || !/^\d+$/.test(startTicks) || !Number.isSafeInteger(group) || group <= 0) throw new Error('Invalid Linux process start identity.');
    return { pid, executable, startTicks, group };
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ESRCH')) return null;
    throw error;
  }
};

export const sameProcess = (expected: ProcessIdentity, observed: ProcessIdentity | null): boolean =>
  observed !== null && expected.pid === observed.pid && expected.executable === observed.executable && expected.startTicks === observed.startTicks;

export const requireStopped = async (identity: ProcessIdentity): Promise<void> => {
  const observed = await processIdentity(identity.pid);
  if (observed !== null && observed.startTicks === identity.startTicks) throw new Error('Original acceptance process is still running; recovery refused.');
};

export const ownedBrowserProcesses = async (directory: string, executables: readonly string[]): Promise<ProcessIdentity[]> => {
  const result: ProcessIdentity[] = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) <= 1) continue;
    try {
      const environment = await readFile(`/proc/${entry}/environ`);
      if (!environment.toString().split('\0').includes(`DAYNIGHT_ACCEPTANCE_DIRECTORY=${directory}`)) continue;
      const identity = await processIdentity(Number(entry));
      if (identity !== null && executables.includes(identity.executable)) result.push(identity);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && ['ENOENT', 'ESRCH', 'EACCES'].includes(String(error.code)))) throw error;
    }
  }
  return result;
};

export const requireGroupStopped = (pid: number): void => {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid acceptance process group.');
  try { process.kill(-pid, 0); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;
    throw error;
  }
  throw new Error('Original acceptance process group is still running; recovery refused.');
};
