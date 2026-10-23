import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

export const storagePlatform = {
  platform: (): NodeJS.Platform => process.platform,
  now: (): number => performance.now(),
  delay: async (milliseconds: number): Promise<void> => { await setTimeout(milliseconds); },
  execute: async (command: string, args: string[], timeout: number, input?: string): Promise<string> => {
    const execution = executeFile(command, args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
    let inputFailure: Error | undefined;
    execution.child.stdin!.once('error', (error: Error) => { inputFailure = error; });
    execution.child.stdin!.end(input);
    const result = await execution;
    if (inputFailure !== undefined) throw inputFailure;
    return result.stdout;
  },
};
