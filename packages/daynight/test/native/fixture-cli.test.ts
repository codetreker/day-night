import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import which from "which";
import { expect, it } from "vitest";

it.runIf(process.platform === "linux")("preserves real fast-child outcomes when Linux reaps the process before identity capture", async () => {
  const temporary = path.resolve(import.meta.dirname, "../../../../.tmp");
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(path.join(temporary, "native-child-race-"));
  try {
    const registry = path.join(root, "registry");
    await mkdir(registry);
    const git = await which("git"), environment = { HOME: root, USERPROFILE: root, PATH: path.dirname(git), LANG: "C", NO_COLOR: "1" };
    const configuration = { ownerToken: randomUUID(), childRegistry: registry };
    const script = [
      `import { executeFixtureCommand } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, "fixture-cli.mjs")).href)};`,
      `const configuration = ${JSON.stringify(configuration)}, environment = ${JSON.stringify(environment)};`,
      `const batches = await Promise.all(Array.from({ length: 8 }, async () => { const outcomes = []; for (let index = 0; index < 8; index++) outcomes.push(await executeFixtureCommand(configuration, ${JSON.stringify(git)}, ["--version"], environment)); return outcomes; }));`,
      `const failure = await executeFixtureCommand(configuration, ${JSON.stringify(process.execPath)}, ["-e", "process.stdout.write('actual-out'); process.stderr.write('actual-error'); process.exitCode = 7;"], environment);`,
      "process.stdout.write(JSON.stringify({ outcomes: batches.flat(), failure }));",
    ].join("\n");
    const raw = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: environment, encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
    const result = JSON.parse(raw) as { outcomes: { code: number | null; signal: string | null; stdout: string; stderr: string }[]; failure: { code: number; signal: string | null; stdout: string; stderr: string } };
    expect(result.outcomes).toHaveLength(64);
    for (const outcome of result.outcomes) expect(outcome).toEqual({ code: 0, signal: null, stdout: expect.stringMatching(/^git version /), stderr: "" });
    expect(result.failure).toEqual({ code: 7, signal: null, stdout: "actual-out", stderr: "actual-error" });
    expect(await readdir(registry)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
