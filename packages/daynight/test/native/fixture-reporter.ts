import path from "node:path";
import { stripVTControlCharacters } from "node:util";

type TestRun = { readonly code: number | null; readonly args: readonly string[]; readonly stdout: string };

const passedBaseline = (stdout: string): boolean => {
  const lines = stripVTControlCharacters(stdout).split(/\r?\n/);
  const tap = lines.some((line) => /^ok [1-9][0-9]* - delivered addition baseline$/.test(line));
  const spec = lines.some((line) => /^✔ delivered addition baseline(?: \([0-9]+(?:\.[0-9]+)?ms\))?$/.test(line));
  const passedSummary = (prefix: "#" | "ℹ"): boolean => {
    const count = (name: string): number | undefined => {
      const pattern = new RegExp(`^${prefix} ${name} ([0-9]+)$`);
      const values = lines.flatMap((line) => { const match = pattern.exec(line); return match === null ? [] : [Number(match[1])]; });
      return values.length === 1 ? values[0] : undefined;
    };
    const tests = count("tests"), passes = count("pass");
    return tests !== undefined && tests > 0 && passes !== undefined && passes > 0 && count("fail") === 0 && count("cancelled") === 0;
  };
  return (tap && passedSummary("#")) || (spec && passedSummary("ℹ"));
};

export const baselineAcceptanceRun = (entry: TestRun, workingDirectory: string): boolean => {
  if (entry.code !== 0 || entry.args[0] !== "--test") return false;
  const arguments_: string[] = [];
  for (let index = 1; index < entry.args.length; index++) {
    const argument = entry.args[index]!;
    if (argument === "--test-reporter" && ["spec", "tap"].includes(entry.args[index + 1]!)) { index++; continue; }
    if (argument === "--test-reporter=spec" || argument === "--test-reporter=tap") continue;
    arguments_.push(argument);
  }
  const files = arguments_.map((argument) => path.resolve(workingDirectory, argument));
  const baseline = path.join(workingDirectory, "baseline.test.mjs"), division = path.join(workingDirectory, "division.test.mjs");
  if (files.length !== 0 && (!files.includes(baseline) || files.some((file) => file !== baseline && file !== division))) return false;
  return passedBaseline(entry.stdout);
};
