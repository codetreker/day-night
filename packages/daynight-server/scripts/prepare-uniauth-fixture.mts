import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withPreparationLock } from "./preparation-lock.mts";

const revision = "0978963813fcefd9d553f6cb9bcc319084c764b3";
const upstream = "https://github.com/codetreker/uniauth.git";
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = join(moduleRoot, ".tmp");
const checkout = join(temporaryRoot, "uniauth-fixture-source");
const fixtureSource = join(moduleRoot, "testdata", "uniauth-fixture");
const targetArguments = process.argv.slice(2);
const targetArgument = targetArguments[0];
if (targetArguments.length > 1 || targetArgument !== undefined && !/^--target=linux\/(?:amd64|arm64)$/.test(targetArgument)) {
  throw new Error("Usage: node prepare-uniauth-fixture.mts [--target=linux/amd64|--target=linux/arm64]");
}
const goos = targetArgument === undefined ? process.platform === "win32" ? "windows" : process.platform : "linux";
const goarch = targetArgument === undefined ? process.arch === "x64" ? "amd64" : process.arch === "ia32" ? "386" : process.arch : targetArgument.slice("--target=linux/".length);
const targetPlatform = targetArgument === undefined ? process.platform : "linux";
const targetArchitecture = targetArgument === undefined ? process.arch : goarch === "amd64" ? "x64" : "arm64";
const binaryName = targetArgument === undefined ? "uniauth-fixture" : `uniauth-fixture-${goos}-${goarch}`;
const binary = join(temporaryRoot, goos === "windows" ? `${binaryName}.exe` : binaryName);
const manifest = `${binary}.json`;
const cancellation = new AbortController();
const cancel = () => cancellation.abort(new Error("UniAuth fixture preparation interrupted"));
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);

const environment = {
  ...process.env,
  GOCACHE: join(temporaryRoot, "go-cache"),
  GOMODCACHE: join(temporaryRoot, "go-mod"),
  GOPATH: join(temporaryRoot, "go"),
  GOBIN: join(temporaryRoot, "bin"),
  TMPDIR: join(temporaryRoot, "tmp"),
  XDG_CONFIG_HOME: join(temporaryRoot, "config"),
  XDG_CACHE_HOME: join(temporaryRoot, "cache"),
  GOENV: "off",
  GOTOOLCHAIN: "go1.27.2",
  GIT_TERMINAL_PROMPT: "0",
  CGO_ENABLED: "0",
  GOOS: goos,
  GOARCH: goarch,
};

const run = async (command: string, args: string[], cwd: string, timeout: number, capture = false, acceptedCodes = [0]): Promise<string> => {
  cancellation.signal.throwIfAborted();
  return await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd, env: environment, stdio: ["ignore", capture ? "pipe" : 2, "inherit"],
      detached: process.platform !== "win32",
    });
    let output = "";
    let failure: Error | undefined;
    let escalation: NodeJS.Timeout | undefined;
    const terminate = (cause: Error) => {
      failure ??= cause;
      const kill = (signal: NodeJS.Signals) => {
        if (child.pid === undefined) return;
        try {
          if (process.platform === "win32") child.kill(signal);
          else process.kill(-child.pid, signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") failure = new Error("Unable to terminate fixture preparation", { cause: error });
        }
      };
      kill("SIGTERM");
      escalation ??= setTimeout(() => kill("SIGKILL"), 2_000);
    };
    const abort = () => terminate(cancellation.signal.reason as Error);
    const deadline = setTimeout(() => terminate(new Error(`${command} exceeded ${timeout}ms`)), timeout);
    cancellation.signal.addEventListener("abort", abort, { once: true });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 1_048_576) terminate(new Error(`${command} output exceeded the preparation limit`));
    });
    child.once("error", (error) => { failure = error; });
    child.once("close", (code, signal) => {
      if (failure !== undefined && child.pid !== undefined && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") failure = new Error("Unable to terminate fixture preparation descendants", { cause: error }); }
      }
      clearTimeout(deadline);
      clearTimeout(escalation);
      cancellation.signal.removeEventListener("abort", abort);
      if (failure !== undefined) reject(failure);
      else if (code === null || !acceptedCodes.includes(code)) reject(new Error(`${command} failed with ${signal === null ? `exit code ${code}` : `signal ${signal}`}`));
      else resolveResult(output.trim());
    });
  });
};

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sourceDigest = async () => {
  const hash = createHash("sha256");
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) hash.update(relative(fixtureSource, path)).update("\0").update(await readFile(path)).update("\0");
      else throw new Error("Fixture source must contain only files and directories");
    }
  };
  await visit(fixtureSource);
  return hash.digest("hex");
};

const prepare = async () => {
  await mkdir(temporaryRoot, { recursive: true });
  await Promise.all(Object.entries(environment).filter(([key]) => ["GOCACHE", "GOMODCACHE", "GOPATH", "GOBIN", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"].includes(key)).map(([, path]) => mkdir(path!, { recursive: true })));
  const sourceHash = await sourceDigest();
  const preparationHash = digest(Buffer.concat([await readFile(fileURLToPath(import.meta.url)), await readFile(new URL("./preparation-lock.mts", import.meta.url))]));
  let initialized = true;
  try { await access(join(checkout, ".git")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    initialized = false;
  }
  if (!initialized) {
    await mkdir(checkout, { recursive: true });
    await run("git", ["init", "--quiet"], checkout, 30_000);
    await run("git", ["remote", "add", "origin", upstream], checkout, 30_000);
  }
  let currentRevision = await run("git", ["rev-parse", "--verify", "--quiet", "HEAD"], checkout, 30_000, true, [0, 1]);
  if (currentRevision !== revision) {
    await run("git", ["fetch", "--no-tags", "--depth=1", "origin", revision], checkout, 180_000);
    await run("git", ["checkout", "--detach", "--force", revision], checkout, 30_000);
    currentRevision = await run("git", ["rev-parse", "HEAD"], checkout, 30_000, true);
  }
  if (currentRevision !== revision) throw new Error("Fetched UniAuth revision does not match the fixture pin");
  await run("git", ["diff", "--quiet", "HEAD", "--"], checkout, 30_000);
  try {
    const cached = JSON.parse(await readFile(manifest, "utf8"));
    await access(binary, constants.X_OK);
    if ((await stat(binary)).isFile() && cached.revision === revision && cached.sourceHash === sourceHash && cached.preparationHash === preparationHash && cached.toolchain === environment.GOTOOLCHAIN && cached.platform === targetPlatform && cached.architecture === targetArchitecture && cached.goos === goos && cached.goarch === goarch && cached.binaryHash === digest(await readFile(binary))) return;
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const destination = join(checkout, "cmd", "daynight-fixture");
  await rm(destination, { recursive: true, force: true });
  await cp(fixtureSource, destination, { recursive: true });
  const stagedBinary = `${binary}.building`;
  try {
    await run("go", ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-o", stagedBinary, "./cmd/daynight-fixture"], checkout, 300_000);
    const binaryHash = digest(await readFile(stagedBinary));
    await rename(stagedBinary, binary);
    await writeFile(`${manifest}.building`, JSON.stringify({ revision, sourceHash, preparationHash, toolchain: environment.GOTOOLCHAIN, platform: targetPlatform, architecture: targetArchitecture, goos, goarch, binaryHash }) + "\n");
    await rename(`${manifest}.building`, manifest);
  } finally {
    await rm(stagedBinary, { force: true });
    await rm(`${manifest}.building`, { force: true });
  }
};

try {
  await withPreparationLock(join(temporaryRoot, "uniauth-fixture-preparation.sqlite"), prepare, { signal: cancellation.signal });
  cancellation.signal.throwIfAborted();
  process.stdout.write(`${binary}\n`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
