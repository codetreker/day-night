import { fileURLToPath } from 'node:url';
import { command } from './acceptance/process.mts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cancellation = new AbortController();
const cancel = (): void => cancellation.abort();
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);

try {
  if (process.env.BUILDX_BUILDER !== undefined && process.env.BUILDX_BUILDER !== 'default') {
    throw new Error('Web CI preparation requires the default Docker builder.');
  }
  const outcomes = await Promise.allSettled([
    command('pnpm', ['--filter', '@codetreker/daynight-web', 'exec', 'playwright', 'install', '--with-deps', 'chromium'],
      { cwd: repositoryRoot, signal: cancellation.signal, timeoutMs: 180_000 }),
    command('pnpm', ['web:test'], { cwd: repositoryRoot, env: { ...process.env, VITEST_MAX_WORKERS: '2' },
      signal: cancellation.signal, timeoutMs: 180_000 }),
    // The deployment runner produces and verifies its own image from this source;
    // cache-only preparation shares the daemon cache without exporting an image.
    command('docker', ['buildx', 'build', '--builder', 'default', '--file', 'deployment/localhost/Dockerfile',
      '--output=type=cacheonly', '.'], { cwd: repositoryRoot, signal: cancellation.signal, timeoutMs: 600_000 }),
  ]);
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason);
  if (failures.length > 0) throw new AggregateError(failures, 'Web coverage, pinned browser and production build preparation must all succeed.');
} finally {
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
