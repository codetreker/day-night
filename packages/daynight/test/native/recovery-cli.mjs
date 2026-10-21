import { appendFile, readFile } from "node:fs/promises";
import { executeFixtureCommand } from "./fixture-cli.mjs";

export const run = async (configurationPath) => {
  const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
  const args = process.argv.slice(2);
  const startedAt = Date.now();
  const read = args[0] === "task" && ["ready", "show", "list", "graph"].includes(args[1])
    || args[0] === "project" && ["list", "show"].includes(args[1]);
  const informational = args.length === 1 && ["--help", "-h", "--version", "-V"].includes(args[0])
    || args.includes("--help") || args.includes("-h");
  const explicitProject = args.some((value) => value === "--project" || value.startsWith("--project="));
  const rejected = (!read && !informational) || explicitProject;
  const result = rejected
    ? { code: 97, signal: null, stdout: "", stderr: "The current request permits context queries only, without selecting an unconfirmed project.\n" }
    : await executeFixtureCommand(configuration, configuration.nodePath, [configuration.entryPath, ...args], { ...process.env, HOME: configuration.home, USERPROFILE: configuration.home });
  await appendFile(configuration.trace, `${JSON.stringify({ args, startedAt, finishedAt: Date.now(), rejected, ...result })}\n`, { mode: 0o600 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code ?? 1;
};
