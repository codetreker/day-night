import { spawn } from "node:child_process";
import { appendFile, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { terminateInstalledProcess } from "../fixtures/installed-cli.ts";

const execute = async (configuration, file, args, environment) => {
  const child = spawn(file, args, { env: { ...environment, DAYNIGHT_NATIVE_OWNER: configuration.ownerToken }, detached: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", (part) => { stdout += part; });
  child.stderr.setEncoding("utf8").on("data", (part) => { stderr += part; });
  const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr })); });
  let registration;
  let timer;
  try {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      try {
        const stat = await readFile(`/proc/${child.pid}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
        const environment = await readFile(`/proc/${child.pid}/environ`);
        if (child.exitCode === null && child.signalCode === null && environment.toString().split("\0").includes(`DAYNIGHT_NATIVE_OWNER=${configuration.ownerToken}`)) {
          if (Number(fields[2]) !== child.pid || !/^[0-9]+$/.test(fields[19])) throw new Error("Owned native child did not receive its own process group.");
          registration = path.join(configuration.childRegistry, `${child.pid}-${fields[19]}.json`);
          await writeFile(registration, JSON.stringify({ pid: child.pid, startTime: fields[19] }), { flag: "wx", mode: 0o600 });
        }
      } catch (cause) {
        // A fast child can be reaped before /proc is read; its close event still owns the result.
        if (cause.code !== "ENOENT" && cause.code !== "ESRCH") throw cause;
      }
    }
    const result = await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), 30_000); })]);
    if (result === "timeout") {
      await terminateInstalledProcess(child, closed);
      throw new Error("Owned native fixture CLI exceeded thirty seconds.");
    }
    return result;
  } catch (cause) {
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      try { await terminateInstalledProcess(child, closed); }
      catch (cleanupError) { throw new AggregateError([cause, cleanupError], "Native fixture child and cleanup failed."); }
    }
    throw cause;
  } finally { clearTimeout(timer); if (registration !== undefined && (child.exitCode !== null || child.signalCode !== null)) await rm(registration, { force: true }); }
};
export { execute as executeFixtureCommand };
const option = (args, name) => {
  const index = args.indexOf(name);
  return index === -1 ? args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) : args[index + 1];
};
const append = (configuration, entry) => appendFile(configuration.trace, `${JSON.stringify(entry)}\n`, { mode: 0o600 });

export const run = async (configurationPath, tool) => {
  const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
  const args = process.argv.slice(2);
  const startedAt = Date.now();
  if (tool === "node") {
    const result = await execute(configuration, configuration.nodePath, args, process.env);
    if (args.includes("--test") || args.some((argument) => argument.startsWith("--test="))) await append(configuration, { actor: "model", tool, args, startedAt, finishedAt: Date.now(), ...result });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.code ?? 1;
    return;
  }
  if (tool === "gh") {
    const target = configuration.prUrls.find((url) => {
      if (args[2] === url) return true;
      const parsed = new URL(url), parts = parsed.pathname.split("/");
      return args[2] === parts[4] && option(args, "--repo") === `${parts[1]}/${parts[2]}`;
    });
    if (args[0] !== "pr" || args[1] !== "view" || target === undefined) throw new Error("The native fixture permits only read-only views of its two delivery PRs.");
    const result = await execute(configuration, configuration.ghPath, args, process.env);
    await append(configuration, { actor: "model", tool, args, prUrl: target, startedAt, finishedAt: Date.now(), ...result });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.code ?? 1;
    return;
  }
  const environment = { ...process.env, HOME: configuration.home, USERPROFILE: configuration.home };
  const invoke = (commandArgs) => execute(configuration, configuration.nodePath, [configuration.entryPath, ...commandArgs], environment);
  if (args[0] === "task" && args[1] === "update" && args[2] === configuration.primaryTaskId && option(args, "--if-version") !== undefined) {
    let first = false;
    try { const lock = await open(configuration.conflictLock, "wx", 0o600); await lock.close(); first = true; }
    catch (cause) { if (cause.code !== "EEXIST") throw cause; }
    if (first) {
      const current = await invoke(["task", "show", configuration.primaryTaskId, "--project", configuration.projectId, "--json"]);
      if (current.code !== 0) throw new Error(`Fixture concurrent read failed: ${current.stderr}`);
      const task = JSON.parse(current.stdout, (key, value, context) => key === "version" && typeof value === "number" ? context.source : value);
      const dependencies = [...new Set([...task.dependsOn, configuration.baselineTaskId])];
      const competingArgs = ["task", "update", configuration.primaryTaskId, "--project", configuration.projectId, "--if-version", task.version, "--description", `${task.description}\n\n${configuration.conflictMarker}`, ...dependencies.flatMap((id) => ["--depends-on", id])];
      const competing = await invoke(competingArgs);
      await append(configuration, { actor: "contender", tool, args: competingArgs, startedAt: Date.now(), finishedAt: Date.now(), ...competing });
      if (competing.code !== 0) throw new Error(`Fixture concurrent update failed: ${competing.stderr}`);
    }
  }
  const result = await invoke(args);
  await append(configuration, { actor: "model", tool, args, startedAt, finishedAt: Date.now(), ...result });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.code ?? 1;
};
