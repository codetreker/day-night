import { readFile } from 'node:fs/promises';

type Coverage = {
  covered: bigint;
  total: bigint;
};

type Block = {
  statements: bigint;
  covered: boolean;
};

export const parseCoverageProfile = (profile: string): Coverage => {
  const lines = profile.split(/\r?\n/);
  if (!/^mode: (set|count|atomic)$/.test(lines.shift() ?? '')) {
    throw new Error('Coverage profile must begin with a valid Go coverage mode.');
  }
  if (lines.at(-1) === '') lines.pop();

  const blocks = new Map<string, Block>();
  for (const [index, line] of lines.entries()) {
    const row = /^(.+):([1-9]\d*)\.([1-9]\d*),([1-9]\d*)\.([1-9]\d*) (0|[1-9]\d*) (0|[1-9]\d*)$/.exec(line);
    if (row === null) {
      throw new Error(`Invalid coverage profile row ${index + 2}.`);
    }
    const [, filename, startLine, startColumn, endLine, endColumn, statements, count] = row;
    if (BigInt(endLine) < BigInt(startLine) ||
      (startLine === endLine && BigInt(endColumn) < BigInt(startColumn))) {
      throw new Error(`Invalid coverage block position at row ${index + 2}.`);
    }
    const key = `${filename}:${startLine}.${startColumn},${endLine}.${endColumn}`;
    const statementCount = BigInt(statements);
    const covered = BigInt(count) > 0n;
    const previous = blocks.get(key);
    if (previous !== undefined && previous.statements !== statementCount) {
      throw new Error(`Inconsistent statement count for coverage block at row ${index + 2}.`);
    }
    blocks.set(key, { statements: statementCount, covered: covered || previous?.covered === true });
  }

  let covered = 0n;
  let total = 0n;
  for (const block of blocks.values()) {
    total += block.statements;
    if (block.covered) covered += block.statements;
  }
  if (total === 0n) {
    throw new Error('Coverage profile contains no statements.');
  }
  return { covered, total };
};

export const requireCoverageAbove90 = ({ covered, total }: Coverage): void => {
  // go-cov accepts exactly 90%; the module requires a strict, unrounded comparison.
  if (covered * 10n <= total * 9n) {
    throw new Error(`Overall coverage must be >90%; covered ${covered} of ${total} statements.`);
  }
};

if (import.meta.main) {
  try {
    if (process.argv.length !== 3) {
      throw new Error('Usage: node scripts/coverage.mts <coverage-profile>');
    }
    const coverage = parseCoverageProfile(await readFile(process.argv[2], 'utf8'));
    requireCoverageAbove90(coverage);
    console.log(`Overall coverage >90%: ${coverage.covered}/${coverage.total} statements.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
