import { fileURLToPath } from 'node:url';
import { command } from './acceptance/process.mts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cancellation = new AbortController();
const cancel = (): void => cancellation.abort();
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);

try {
  const outcomes = await Promise.allSettled([
    command('pnpm', ['--filter', '@codetreker/daynight-web', 'exec', 'playwright', 'install', '--with-deps', 'chromium'],
      { cwd: repositoryRoot, signal: cancellation.signal, timeoutMs: 180_000 }),
    command('pnpm', ['web:test'], { cwd: repositoryRoot, signal: cancellation.signal, timeoutMs: 180_000 }),
  ]);
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason);
  if (failures.length > 0) throw new AggregateError(failures, 'Web coverage and pinned browser preparation must both succeed.');
} finally {
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
