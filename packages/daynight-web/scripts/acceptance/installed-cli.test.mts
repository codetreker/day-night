import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAcceptanceCli, recordCliProcess, recoverCliProcesses, validateInstalledCli, type InstalledCliReceipt } from './installed-cli.mts';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const acceptance = join(repository, 'packages/daynight-web/.tmp/acceptance');
const privateRoot = join(repository, 'packages/daynight-web/.tmp/acceptance-private');
const source = { gitSha: '0123456789abcdef0123456789abcdef01234567', dirty: true };
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const fixture = async (run: (value: { directory: string; receiptPath: string; receipt: InstalledCliReceipt; evidence: Record<string, unknown> }) => Promise<void>): Promise<void> => {
  const directory = join(acceptance, `20261021123456-${randomUUID()}`);
  const root = join(directory, 'installed-cli');
  const entryPath = join(root, 'consumer install/node_modules/@codetreker/daynight/dist/main.js');
  const launcherPath = join(root, 'consumer install/node_modules/.bin', process.platform === 'win32' ? 'daynight.cmd' : 'daynight');
  const tarballPath = join(root, 'daynight.tgz');
  await mkdir(dirname(entryPath), { recursive: true });
  await mkdir(dirname(launcherPath), { recursive: true });
  await writeFile(entryPath, `
    if(process.argv[2]==='bytes')process.stdout.write(Buffer.from([0,255,128,10]));
    else if(process.argv[2]==='missing'){process.stderr.write('not_found\\n');process.exitCode=1;}
    else if(process.argv[2]==='leak'){const{readFileSync}=await import('node:fs');process.stderr.write(readFileSync(process.env.HOME+'/.daynight/config.yml'));process.exitCode=1;}
    else if(process.argv[2]==='colors'){const{WriteStream}=await import('node:tty');WriteStream.prototype.getColorDepth();process.stdout.write('color-safe\\n');}
    else {process.stdout.write(JSON.stringify({cwd:process.cwd(),home:process.env.HOME})+'\\n');}
  `);
  await writeFile(tarballPath, 'packed fixture');
  await writeFile(launcherPath, 'launcher');
  const manifest = JSON.parse(await readFile(join(repository, 'packages/daynight/package.json'), 'utf8')) as { version: string };
  await writeFile(join(dirname(dirname(entryPath)), 'package.json'), JSON.stringify({ name: '@codetreker/daynight', version: manifest.version, bin: { daynight: 'dist/main.js' }, type: 'module' }));
  const receipt: InstalledCliReceipt = { schemaVersion: 1, root, packageVersion: manifest.version, tarballPath, tarballSha256: hash(await readFile(tarballPath)),
    nodePath: process.execPath, entryPath, entrySha256: hash(await readFile(entryPath)), launcherPath, source };
  const receiptPath = join(root, 'installed-cli.json');
  const evidence = { runId: directory.split('/').at(-1), source, installedCli: { root, receiptPath, receipt } };
  await writeFile(receiptPath, JSON.stringify(receipt));
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence));
  const originalReceipt = process.env.DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT;
  const ci = process.env.CI;
  delete process.env.CI;
  process.env.DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT = receiptPath;
  try { await run({ directory, receiptPath, receipt, evidence }); }
  finally {
    if (originalReceipt === undefined) delete process.env.DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT; else process.env.DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT = originalReceipt;
    if (ci === undefined) delete process.env.CI; else process.env.CI = ci;
    await rm(directory, { recursive: true, force: true });
    await rm(join(privateRoot, basename(directory)), { recursive: true, force: true });
  }
};

test('installed bridge validates parent artifact evidence and preserves installed CLI output', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async ({ directory, receiptPath, receipt }) => {
    assert.deepEqual(await validateInstalledCli(receiptPath, directory), receipt);
    const workspace = join(directory, 'native/functional/test-results/cli');
    const cli = await createAcceptanceCli('http://127.0.0.1:12345', workspace, 'dnpat_private-test-token');
    assert.deepEqual(await cli.read(['bytes']), Buffer.from([0, 255, 128, 10]));
    const ordinary = await cli.run(['text']);
    assert.equal(ordinary.exitCode, 0);
    assert.equal(ordinary.stdout.endsWith('\n'), true);
    const paths = JSON.parse(ordinary.stdout) as { cwd: string; home: string };
    assert.equal(paths.cwd, join(workspace, 'workspace'));
    assert.equal(paths.home.startsWith(join(privateRoot, basename(directory), 'cli') + '/'), true);
    assert.equal(paths.home.startsWith(directory + '/'), false);
    await assert.rejects(readFile(join(workspace, 'home/.daynight/config.yml')), { code: 'ENOENT' });
    assert.equal(await readFile(join(paths.home, '.daynight/config.yml'), 'utf8'), 'serverUrl: "http://127.0.0.1:12345"\nserverToken: "dnpat_private-test-token"\n');
    assert.equal((await stat(join(paths.home, '.daynight/config.yml'))).mode & 0o777, 0o600);
    assert.equal((await readFile(join(directory, 'evidence.json'), 'utf8')).includes('dnpat_private-test-token'), false);
    assert.deepEqual(await cli.run(['missing']), { exitCode: 1, stdout: '', stderr: 'not_found\n' });
    await assert.rejects(cli.read(['missing']), /not_found/);
    assert.equal((await readdir(join(directory, 'cli-processes'))).length, 4);
    await cli.close();
    await cli.close();
    await assert.rejects(readFile(join(paths.home, '.daynight/config.yml')), { code: 'ENOENT' });
    await assert.rejects(cli.run(['text']), /already closed/);
    assert.deepEqual(await validateInstalledCli(receiptPath, directory), receipt);
    await recoverCliProcesses(directory, receiptPath, receipt);
  });
});

test('receipt validation rejects source, package, hash and containment changes', async () => {
  await fixture(async ({ directory, receiptPath, receipt, evidence }) => {
    for (const changed of [
      { ...receipt, source: { ...source, gitSha: 'f'.repeat(40) } },
      { ...receipt, source: { ...source, dirty: false } },
      { ...receipt, packageVersion: '999.0.0' },
      { ...receipt, entryPath: process.execPath },
      { ...receipt, root: dirname(directory) },
    ]) {
      await writeFile(receiptPath, JSON.stringify(changed));
      await assert.rejects(validateInstalledCli(receiptPath, directory));
    }
    await writeFile(receiptPath, JSON.stringify(receipt));
    await writeFile(receipt.tarballPath, 'changed tarball');
    await assert.rejects(validateInstalledCli(receiptPath, directory), /hash/);
    await writeFile(receipt.tarballPath, 'packed fixture');
    await writeFile(receipt.entryPath, 'changed entry');
    await assert.rejects(validateInstalledCli(receiptPath, directory), /hash/);
    await writeFile(join(directory, 'evidence.json'), JSON.stringify({ ...evidence, source: { ...source, dirty: false } }));
    await assert.rejects(validateInstalledCli(receiptPath, directory), /source/);
  });
});

test('CI receipt validation requires the clean exact GitHub source', async () => {
  await fixture(async ({ directory, receiptPath }) => {
    process.env.CI = 'true';
    await assert.rejects(validateInstalledCli(receiptPath, directory), /clean GITHUB_SHA/);
  });
});

test('recovery terminates only recorded installed CLI groups', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async ({ directory, receiptPath, receipt }) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore', env: { ...process.env,
      DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT: receiptPath, DAYNIGHT_ACCEPTANCE_RUN_DIRECTORY: directory } });
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      await recordCliProcess(directory, receiptPath, child);
      await recoverCliProcesses(directory, receiptPath, receipt);
      await closed;
      assert.equal(child.signalCode, 'SIGTERM');
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; }
  });
});

test('an exclusive fixture root failure preserves a preexisting installation', async () => {
  await fixture(async ({ directory, receipt }) => {
    const before = await readFile(receipt.entryPath);
    const producer = await import(new URL('../../../daynight/test/fixtures/installed-cli.ts', import.meta.url).href) as {
      createInstalledCli: (options: { temporaryRoot: string; rootDirectory: string }) => Promise<unknown>;
    };
    await assert.rejects(producer.createInstalledCli({ temporaryRoot: directory, rootDirectory: receipt.root }), { code: 'EEXIST' });
    assert.deepEqual(await readFile(receipt.entryPath), before);
    assert.equal(await readFile(receipt.tarballPath, 'utf8'), 'packed fixture');
  });
});

test('captured CLI output disables inherited forced color without changing the parent environment', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async ({ directory }) => {
    const previousForce = process.env.FORCE_COLOR;
    const previousNoColor = process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    process.env.NO_COLOR = '1';
    try {
      const workspace = join(directory, 'native/functional/test-results/color-cli');
      const cli = await createAcceptanceCli('http://127.0.0.1:12345', workspace, 'dnpat_private-test-token');
      try {
        const result = await cli.run(['colors']);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, '');
        assert.equal(result.stdout, 'color-safe\n');
        assert.equal(process.env.FORCE_COLOR, '1');
        assert.equal(process.env.NO_COLOR, '1');
      } finally { await cli.close(); }
    } finally {
      if (previousForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = previousForce;
      if (previousNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = previousNoColor;
    }
  });
});


test('CLI recovery removes private credentials while preserving installed evidence and unrelated private runs', { skip: process.platform !== 'linux' }, async () => {
  await fixture(async ({ directory, receiptPath, receipt }) => {
    const workspace = join(directory, 'native/functional/test-results/recovery-cli');
    const cli = await createAcceptanceCli('http://127.0.0.1:12345', workspace, 'dnpat_private-test-token');
    const result = await cli.run(['text']);
    const { home } = JSON.parse(result.stdout) as { home: string };
    const unrelated = join(privateRoot, `20261021123456-${randomUUID()}`, 'cli/other/home/.daynight/config.yml');
    await mkdir(dirname(unrelated), { recursive: true });
    await writeFile(unrelated, 'operator-private-configuration', { mode: 0o600 });
    try {
      await assert.rejects(cli.read(['leak']), (error: Error) => {
        assert.match(error.message, /exposed its private acceptance credential/);
        assert.equal(error.message.includes('dnpat_private-test-token'), false);
        return true;
      });
      await recoverCliProcesses(directory, receiptPath, receipt);
      await assert.rejects(readFile(join(home, '.daynight/config.yml')), { code: 'ENOENT' });
      assert.equal(await readFile(unrelated, 'utf8'), 'operator-private-configuration');
      assert.deepEqual(await validateInstalledCli(receiptPath, directory), receipt);
    } finally {
      await cli.close();
      await rm(join(privateRoot, unrelated.slice(privateRoot.length + 1).split('/')[0]!), { recursive: true, force: true });
    }
  });
});
