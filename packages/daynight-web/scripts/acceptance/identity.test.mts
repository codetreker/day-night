import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { processIdentity, requireGroupStopped, requireStopped, sameProcess } from './identity.mts';

test('Linux identity records executable and start time and rejects an active owner', async () => {
  const identity = await processIdentity(process.pid);
  assert.notEqual(identity, null);
  assert.ok(sameProcess(identity!, identity));
  assert.equal(sameProcess({ ...identity!, startTicks: '0' }, identity), false);
  await assert.rejects(requireStopped(identity!), /still running/);
  await assert.rejects(requireStopped({ ...identity!, executable: '/different-executable' }), /still running/);
});
test('process group recovery refuses an active owned group and accepts its completed group', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => { child.once('spawn', () => resolve()); child.once('error', reject); });
    const identity = await processIdentity(child.pid!);
    assert.notEqual(identity, null);
    assert.throws(() => requireGroupStopped(child.pid!), /still running/);
    child.kill('SIGTERM'); await exited;
    await requireStopped(identity!);
    requireGroupStopped(child.pid!);
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } }
});
test('invalid process identities fail before process operations', async () => {
  for (const pid of [0, 1, -1, 1.5, NaN]) {
    await assert.rejects(processIdentity(pid));
    assert.throws(() => requireGroupStopped(pid));
  }
});
