import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScanner, SyntaxKind } from 'typescript/unstable/ast';

type Coverage = { covered: bigint; total: bigint };
type SourceCoverage = Coverage & { path: string; runtime: boolean };
export type CoverageSummary = Coverage & { files: SourceCoverage[] };
type SourceFile = { path: string; text: string };

const object = (value: unknown, subject: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${subject} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const integer = (value: unknown, minimum: number, subject: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${subject} must be a safe integer >=${minimum}.`);
  }
  return value;
};

const location = (value: unknown, subject: string, end = false): { line: number; column: number } => {
  const position = object(value, subject);
  // The provider uses Infinity for unmapped line ends; JSON serializes it as null.
  // https://github.com/AriPerkkio/ast-v8-to-istanbul/blob/cff54c159a85d73176fc4aefc4141970704fce47/src/location.ts#L99-L100
  return {
    line: integer(position.line, 1, `${subject}.line`),
    column: end && position.column === null ? Infinity : integer(position.column, 0, `${subject}.column`),
  };
};

const sourcePaths = async (directory: string): Promise<string[]> => {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Source symlinks are unsupported: ${path}`);
    if (entry.isDirectory()) paths.push(...await sourcePaths(path));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) paths.push(path);
  }
  return paths.sort();
};

export const hasRuntimeJavaScript = (javascript: string): boolean => {
  const scanner = createScanner(true, undefined, javascript);
  let token = scanner.scan();
  while (token !== SyntaxKind.EndOfFile) {
    if (token === SyntaxKind.SemicolonToken) { token = scanner.scan(); continue; }
    if (token !== SyntaxKind.ExportKeyword
      || scanner.scan() !== SyntaxKind.OpenBraceToken
      || scanner.scan() !== SyntaxKind.CloseBraceToken) return true;
    token = scanner.scan();
    if (token !== SyntaxKind.SemicolonToken && token !== SyntaxKind.EndOfFile) return true;
  }
  return false;
};

export const classifySourceFiles = async (sources: SourceFile[], packageDirectory: string): Promise<Map<string, boolean>> => {
  const temporaryRoot = join(packageDirectory, '.tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, 'coverage-emit-'));
  let failure: unknown;
  try {
    const inputRoot = join(directory, 'input');
    const outputRoot = join(directory, 'output');
    const inputs: { source: SourceFile; input: string; output: string }[] = [];
    for (const source of sources) {
      const sourcePath = relative(join(packageDirectory, 'src'), source.path);
      // A fixed input basename makes declaration contents ordinary TypeScript
      // while retaining original paths as directories without naming collisions.
      const input = join(inputRoot, sourcePath, source.path.endsWith('.tsx') ? 'source.tsx' : 'source.ts');
      const output = join(outputRoot, relative(inputRoot, input).replace(/\.tsx?$/, '.js'));
      await mkdir(dirname(input), { recursive: true });
      await writeFile(input, source.text);
      inputs.push({ source, input, output });
    }
    const compiler = join(dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))), 'bin/tsc');
    const emitted = spawnSync(process.execPath, [compiler,
      '--ignoreConfig', '--noCheck', '--noResolve',
      '--target', 'ESNext', '--module', 'ESNext', '--jsx', 'react-jsx',
      '--moduleDetection', 'force',
      '--verbatimModuleSyntax', '--isolatedModules', '--removeComments',
      '--rootDir', inputRoot, '--outDir', outputRoot,
      ...inputs.map(({ input }) => input),
    ], { cwd: packageDirectory, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    if (emitted.error !== undefined) throw new Error('Cannot emit product source for coverage classification.', { cause: emitted.error });
    if (emitted.status !== 0) throw new Error(`Cannot emit product source for coverage classification: ${emitted.stdout}${emitted.stderr}`);
    const classifications = new Map<string, boolean>();
    for (const { source, output } of inputs) classifications.set(source.path, hasRuntimeJavaScript(await readFile(output, 'utf8')));
    return classifications;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try { await rm(directory, { recursive: true, force: true }); }
    catch (error) {
      if (failure !== undefined) throw new AggregateError([failure, error], 'Coverage source classification and cleanup failed.');
      throw error;
    }
  }
};

const countStatements = (entry: Record<string, unknown>, path: string): Coverage => {
  const statements = object(entry.statementMap, `statementMap for ${path}`);
  const counts = object(entry.s, `s for ${path}`);
  const ids = Object.keys(statements).sort();
  if (JSON.stringify(ids) !== JSON.stringify(Object.keys(counts).sort())) {
    throw new Error(`Statement IDs do not match counters for ${path}.`);
  }
  let covered = 0n;
  for (const id of ids) {
    if (!/^(0|[1-9]\d*)$/.test(id)) throw new Error(`Invalid statement ID for ${path}: ${id}`);
    const statement = object(statements[id], `statement ${id} for ${path}`);
    const start = location(statement.start, `statement ${id} start for ${path}`);
    const end = location(statement.end, `statement ${id} end for ${path}`, true);
    if (end.line < start.line || (end.line === start.line && end.column < start.column)) {
      throw new Error(`Invalid statement range for ${path}: ${id}`);
    }
    if (integer(counts[id], 0, `counter ${id} for ${path}`) > 0) covered += 1n;
  }
  return { covered, total: BigInt(ids.length) };
};

export const analyzeCoverage = async (report: unknown, packageDirectory: string): Promise<CoverageSummary> => {
  const packageRoot = resolve(packageDirectory);
  const sourceRoot = join(packageRoot, 'src');
  const paths = await sourcePaths(sourceRoot);
  if (paths.length === 0) throw new Error('Product source manifest contains no TypeScript files.');
  const sources = await Promise.all(paths.map(async (path) => ({ path, text: await readFile(path, 'utf8') })));
  const classifications = await classifySourceFiles(sources, packageRoot);
  const entries = new Map<string, Record<string, unknown>>();
  for (const [key, value] of Object.entries(object(report, 'Coverage report'))) {
    const entry = object(value, `Coverage entry ${key}`);
    if (key.length === 0 || typeof entry.path !== 'string' || entry.path.length === 0) {
      throw new Error(`Coverage entry has an invalid path: ${key}`);
    }
    const keyPath = resolve(packageRoot, key);
    if (keyPath !== resolve(packageRoot, entry.path)) {
      throw new Error(`Coverage key and entry path disagree: ${key}`);
    }
    if (entries.has(keyPath)) throw new Error(`Duplicate coverage identity: ${key}`);
    entries.set(keyPath, entry);
  }

  const files: SourceCoverage[] = [];
  let covered = 0n;
  let total = 0n;
  for (const path of paths) {
    const runtime = classifications.get(path)!;
    const entry = entries.get(path);
    const label = relative(packageRoot, path).split(sep).join('/');
    if (runtime && entry === undefined) throw new Error(`Coverage report is missing runtime product source: ${label}`);
    const counts = entry === undefined ? { covered: 0n, total: 0n } : countStatements(entry, label);
    if (runtime && counts.total === 0n) throw new Error(`Runtime product source has no statements: ${label}`);
    if (!runtime && counts.total !== 0n) throw new Error(`Type-only product source has runtime statements in coverage: ${label}`);
    files.push({ path: label, runtime, ...counts });
    covered += counts.covered;
    total += counts.total;
  }
  if (total === 0n) throw new Error('Coverage report contains no product statements.');
  return { covered, total, files };
};

export const requireCoverageAbove90 = ({ covered, total }: Coverage): void => {
  if (total <= 0n || covered < 0n || covered > total) throw new Error('Invalid coverage totals.');
  if (covered * 10n <= total * 9n) {
    throw new Error(`Overall web coverage must be >90%; covered ${covered} of ${total} statements.`);
  }
};

export const checkCoverage = async (reportPath: string, packageDirectory: string): Promise<CoverageSummary> =>
  analyzeCoverage(JSON.parse(await readFile(resolve(packageDirectory, reportPath), 'utf8')), packageDirectory);

if (import.meta.main) {
  const packageDirectory = process.cwd();
  const summaryPath = join(packageDirectory, '.tmp/coverage/summary.json');
  try {
    await rm(summaryPath, { force: true });
    if (process.argv.length > 3) throw new Error('Usage: node scripts/coverage.mts [coverage-report]');
    const reportPath = process.argv[2] ?? '.tmp/coverage/coverage-final.json';
    const summary = await checkCoverage(reportPath, packageDirectory);
    const passed = summary.covered * 10n > summary.total * 9n;
    await mkdir(dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, `${JSON.stringify({ ...summary, result: passed ? 'passed' : 'failed' }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2)}\n`);
    requireCoverageAbove90(summary);
    console.log(`Overall web coverage >90%: ${summary.covered}/${summary.total} statements across ${summary.files.length} product files.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
