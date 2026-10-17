import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import crossSpawn from "cross-spawn";
import Database from "better-sqlite3";

const command = (file: string, args: readonly string[]): string => {
  const result = crossSpawn.sync(file, [...args], {
    encoding: "utf8", shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 1_048_576,
  });
  if (result.error !== undefined && result.error !== null) throw result.error;
  if (result.status !== 0 || result.signal !== null) {
    throw new Error(`Cannot record ${file} ${args.join(" ")}: exit=${result.status}, signal=${result.signal}; ${result.stderr}`);
  }
  return result.stdout.trim();
};
const version = (file: string): string => {
  const output = command(file, ["--version"]);
  if (output === "") throw new Error(`The ${file} version command returned no output.`);
  return output.split(/\r?\n/)[0]!;
};

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string; dependencies: Record<string, string>;
};
const database = new Database(":memory:");
let sqliteVersion: string;
try { sqliteVersion = (database.prepare("SELECT sqlite_version() AS version").get() as { version: string }).version; }
finally { database.close(); }
const { header } = process.report.getReport() as { header: { glibcVersionRuntime?: string } };
const evidence = {
  capturedAt: new Date().toISOString(),
  sourceRevision: command("git", ["rev-parse", "HEAD"]),
  sourceDirty: command("git", ["status", "--porcelain"]) !== "",
  platform: process.platform,
  architecture: process.arch,
  osRelease: os.release(),
  osVersion: os.version(),
  glibcVersionRuntime: header.glibcVersionRuntime,
  versions: { node: process.version, nodeAbi: process.versions.modules, nodeApi: process.versions.napi,
    pnpm: version("pnpm"), git: version("git"), gh: version("gh") },
  packageVersion: manifest.version,
  sqlite: { packageVersion: manifest.dependencies["better-sqlite3"], engineVersion: sqliteVersion },
  liveCopilotExercised: false,
};
const directory = path.resolve(".tmp");
await mkdir(directory, { recursive: true });
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
await writeFile(path.join(directory, "validation-environment.json"), serialized);
process.stdout.write(serialized);
