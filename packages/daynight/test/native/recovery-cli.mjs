import { appendFile, readFile } from "node:fs/promises";
import { executeFixtureCommand } from "./fixture-cli.mjs";

export const observedProjectSelection = (configuration, args, traces) => {
  const selection = args.flatMap((value, index) => value === "--project" ? [args[index + 1]] : value.startsWith("--project=") ? [value.slice("--project=".length)] : []);
  if (selection.length === 0) return true;
  if (configuration.kind !== "service_failure" || selection.length !== 1 || selection[0] !== configuration.projectId) return false;
  const inventory = traces.findLast((entry) => entry.tool === "daynight" && entry.args[0] === "project" && entry.args[1] === "list" && entry.args.includes("--json") && entry.code === 0);
  if (inventory === undefined) return false;
  const projects = JSON.parse(inventory.stdout);
  if (!Array.isArray(projects)) throw new Error("Observed project inventory is not a complete JSON array.");
  const matching = projects.filter((project) => project.repoUrl === configuration.repoUrl);
  return matching.length === 1 && matching[0].id === configuration.projectId;
};

const readOnlyGit = (args) => {
  const values = [...args];
  while (values[0]?.startsWith("-")) {
    if (["--no-optional-locks", "--no-pager", "--literal-pathspecs"].includes(values[0])) values.shift();
    else if (["-C", "-c"].includes(values[0])) values.splice(0, 2);
    else return false;
  }
  const command = values.shift();
  if (["status", "log", "ls-files", "rev-parse", "diff", "show"].includes(command)) return true;
  if (command === "remote") return values.length === 0 || values.every((value) => value === "-v" || value === "--verbose") || values[0] === "get-url";
  if (command === "config") return values.some((value) => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(value));
  return false;
};

export const run = async (configurationPath, tool = "daynight") => {
  const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
  const args = process.argv.slice(2);
  const startedAt = Date.now();
  const read = args[0] === "task" && ["ready", "show", "list", "graph"].includes(args[1])
    || args[0] === "project" && ["list", "show"].includes(args[1]);
  const informational = args.length === 1 && ["--help", "-h", "--version", "-V"].includes(args[0])
    || args.includes("--help") || args.includes("-h");
  const traces = (await readFile(configuration.trace, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const rejected = tool === "git" ? !readOnlyGit(args) : (!read && !informational) || !observedProjectSelection(configuration, args, traces);
  const result = rejected
    ? { code: 97, signal: null, stdout: "", stderr: "The current request permits context queries only, without selecting an unconfirmed project.\n" }
    : await executeFixtureCommand(configuration, tool === "git" ? configuration.gitPath : configuration.nodePath, tool === "git" ? args : [configuration.entryPath, ...args], { ...process.env, HOME: configuration.home, USERPROFILE: configuration.home });
  await appendFile(configuration.trace, `${JSON.stringify({ tool, args, startedAt, finishedAt: Date.now(), rejected, ...result })}\n`, { mode: 0o600 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code ?? 1;
};
