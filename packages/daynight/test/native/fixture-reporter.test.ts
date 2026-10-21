import path from "node:path";
import { expect, it } from "vitest";
import { baselineAcceptanceRun } from "./fixture-reporter.js";

const workingDirectory = path.resolve("native-reporter-fixture");
const spec = "✔ delivered addition baseline (0.732659ms)\nℹ tests 1\nℹ suites 0\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 63.869167\n";
const tap = "TAP version 13\n# Subtest: delivered addition baseline\nok 1 - delivered addition baseline\n  ---\n  duration_ms: 0.732659\n  type: 'test'\n  ...\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 63.869167\n";
const run = (stdout: string, args: readonly string[] = ["--test", "baseline.test.mjs"], code: number | null = 0): boolean => baselineAcceptanceRun({ stdout, args, code }, workingDirectory);

it.each([spec, tap])("accepts an executed passing baseline with the native Spec or TAP summary", (stdout) => {
  expect(run(stdout)).toBe(true);
  expect(run(stdout, ["--test"])).toBe(true);
  expect(run(stdout, ["--test", "./baseline.test.mjs", "division.test.mjs"])).toBe(true);
  expect(run(stdout, ["--test", path.join(workingDirectory, "baseline.test.mjs")])).toBe(true);
  expect(run(stdout, ["--test", "--test-reporter=tap", "baseline.test.mjs"])).toBe(true);
});

it("accepts terminal control sequences and CRLF without weakening the reporter facts", () => {
  expect(run(spec.replace("✔", "\u001b[32m✔\u001b[39m").replaceAll("\n", "\r\n"))).toBe(true);
});

it.each([spec, tap])("rejects filtered, different-file, unsuccessful, and zero-selected invocations", (stdout) => {
  expect(run(stdout, ["--test", "division.test.mjs"])).toBe(false);
  expect(run(stdout, ["--test", "baseline.test.mjs", "--test-name-pattern", "unrelated"])).toBe(false);
  expect(run(stdout, ["--test", "--test-only", "baseline.test.mjs"])).toBe(false);
  expect(run(stdout, ["--test", "other.test.mjs"])).toBe(false);
  expect(run(stdout, ["--test"], 1)).toBe(false);
  expect(run(stdout, ["--test"], null)).toBe(false);
  expect(run(stdout.replace(/tests 1/g, "tests 0").replace(/pass 1/g, "pass 0"))).toBe(false);
  expect(run(stdout.replaceAll("delivered addition baseline", "unrelated passing test"))).toBe(false);
});

it("rejects skipped, failed, cancelled, missing-summary and duplicate-summary baselines", () => {
  expect(run(tap.replace("ok 1 - delivered addition baseline", "ok 1 - delivered addition baseline # SKIP"))).toBe(false);
  expect(run(spec.replace("✔ delivered addition baseline", "﹣ delivered addition baseline"))).toBe(false);
  expect(run(spec.replace("ℹ fail 0", "ℹ fail 1"))).toBe(false);
  expect(run(tap.replace("# cancelled 0", "# cancelled 1"))).toBe(false);
  expect(run("✔ delivered addition baseline (0.732659ms)\n")).toBe(false);
  expect(run(`${spec}ℹ pass 1\n`)).toBe(false);
});
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

it("parses actual Node 24 default and TAP reporters in the fixture's isolated environment", async () => {
  const temporary = path.resolve(import.meta.dirname, "../../../../.tmp");
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(path.join(temporary, "native-reporter-"));
  try {
    const home = path.join(root, "home");
    await mkdir(home);
    await writeFile(path.join(root, "baseline.test.mjs"), "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('delivered addition baseline', () => assert.equal(2 + 3, 5));\n");
    const environment = { HOME: home, USERPROFILE: home, NO_COLOR: "1", TERM: "xterm-256color" };
    for (const args of [["--test", "baseline.test.mjs"], ["--test", "--test-reporter=tap", "baseline.test.mjs"]]) {
      const stdout = execFileSync(process.execPath, args, { cwd: root, env: environment, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
      expect(baselineAcceptanceRun({ stdout, args, code: 0 }, root), stdout).toBe(true);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
