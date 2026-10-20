import { spawn, type ChildProcess } from 'node:child_process';

export type CommandOptions = {
  cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; quiet?: boolean; signal?: AbortSignal;
  forceAfterMs?: number; onOutput?: (chunk: string) => void;
  onSpawn?: (child: ChildProcess) => void;
};
export const terminateGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (child.pid === undefined) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
};

export const command = async (file: string, args: readonly string[], options: CommandOptions): Promise<string> => {
  options.signal?.throwIfAborted();
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(file, args, { cwd: options.cwd, env: options.env ?? process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.once('spawn', () => options.onSpawn?.(child));
    const output: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const stop = (error: Error): void => {
      failure ??= error;
      terminateGroup(child, 'SIGTERM');
      forceTimer ??= setTimeout(() => terminateGroup(child, 'SIGKILL'), options.forceAfterMs ?? 5_000);
    };
    let forceTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => stop(new Error(`Acceptance command timed out: ${file}`)), options.timeoutMs ?? 60_000);
    const abort = (): void => stop(new Error('Acceptance command cancelled.'));
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout!.on('data', (data: Buffer) => {
      options.onOutput?.(data.toString('utf8'));
      if (!options.quiet) process.stdout.write(data);
      bytes += data.length;
      if (bytes > 8 * 1024 * 1024) stop(new Error('Acceptance command exceeded its bounded output.'));
      else output.push(data);
    });
    child.stderr!.on('data', (data: Buffer) => { if (!options.quiet) process.stderr.write(data); });
    child.once('error', (error) => { failure ??= error; });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      options.signal?.removeEventListener('abort', abort);
      if (failure !== undefined) reject(failure);
      else if (code !== 0) reject(new Error(`Acceptance command failed: ${file} (exit=${code}, signal=${signal})`));
      else resolve(Buffer.concat(output).toString('utf8').trim());
    });
  });
};
