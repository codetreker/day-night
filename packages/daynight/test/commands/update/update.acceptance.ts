import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { execFileSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import crossSpawn from "cross-spawn";
import { expect, it } from "vitest";

const workspace = path.resolve(import.meta.dirname, "../../../../..");
const packageDirectory = path.join(workspace, "packages/daynight");
const packageName = "@codetreker/daynight";
type Manifest = { name: string; version: string; [key: string]: unknown };
type Result = { status: number | null; stdout: string; stderr: string };

it("replaces its real npm global installation and preserves npm configuration and review state", async () => {
  const temporary = path.join(workspace, ".tmp");
  mkdirSync(temporary, { recursive: true });
  const evidenceFile = path.join(temporary, "update-evidence.json");
  rmSync(evidenceFile, { force: true });
  const directory = mkdtempSync(path.join(temporary, "npm self update 中文 "));
  const children = new Set<ChildProcess>();
  const server = createServer();
  const terminate = async (child: ChildProcess): Promise<void> => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    if (process.platform === "win32") {
      await new Promise<void>((resolve, reject) => {
        const terminator = crossSpawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "inherit", timeout: 10_000 });
        terminator.once("error", reject);
        terminator.once("close", (status) => status === 0 ? resolve() : reject(new Error(`Cannot terminate acceptance process tree: taskkill exited with ${String(status)}.`)));
      });
    } else {
      const processes = execFileSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8", timeout: 5_000 }).trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
      const owned = new Set([child.pid]);
      let previous = 0;
      while (owned.size !== previous) {
        previous = owned.size;
        for (const [pid, parent] of processes) if (pid !== undefined && parent !== undefined && owned.has(parent)) owned.add(pid);
      }
      for (const pid of [...owned].reverse()) {
        try { process.kill(pid, "SIGKILL"); }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
      }
    }
    await closed;
  };
  try {
    const home = path.join(directory, "isolated home 中文");
    const prefix = path.join(directory, "original npm prefix 中文");
    const unrelatedPrefix = path.join(directory, "unrelated default prefix 中文");
    const caller = path.join(directory, "caller project 中文");
    const artifacts = path.join(directory, "packed artifacts");
    const cache = path.join(directory, "npm cache 中文");
    const state = path.join(home, ".daynight");
    for (const location of [home, prefix, caller, artifacts, state]) mkdirSync(location, { recursive: true });
    const userConfiguration = path.join(directory, "user.npmrc");
    const globalConfiguration = path.join(directory, "global.npmrc");
    writeFileSync(globalConfiguration, "");
    const projectConfiguration = path.join(caller, ".npmrc");
    const projectContents = "@codetreker:registry=http://127.0.0.1:1/\nregistry=http://127.0.0.1:1/\n";
    writeFileSync(projectConfiguration, projectContents);
    writeFileSync(path.join(caller, "package.json"), JSON.stringify({ name: "unrelated-caller", private: true }));
    const configurationContents = "invalid: [yaml\n";
    const databaseContents = Buffer.from("This is deliberately not a SQLite database.\n");
    writeFileSync(path.join(state, "config.yml"), configurationContents);
    writeFileSync(path.join(state, "state.sqlite"), databaseContents);
    const environment: NodeJS.ProcessEnv = { ...process.env };
    for (const name of Object.keys(environment)) {
      if (/^(?:npm_config_|node_options$|daynight_|path$)/i.test(name)) delete environment[name];
    }
    Object.assign(environment, {
      HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, "config"),
      XDG_CACHE_HOME: path.join(home, "cache"), APPDATA: path.join(home, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(home, "AppData", "Local"),
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`,
      NPM_CONFIG_USERCONFIG: userConfiguration, NPM_CONFIG_GLOBALCONFIG: globalConfiguration,
      NPM_CONFIG_PREFIX: unrelatedPrefix, NO_COLOR: "1",
    });
    const nodeDirectory = path.dirname(realpathSync(process.execPath));
    const npmCli = [path.join(nodeDirectory, "node_modules/npm/bin/npm-cli.js"), path.resolve(nodeDirectory, "../lib/node_modules/npm/bin/npm-cli.js")].find(existsSync);
    if (npmCli === undefined) throw new Error("The acceptance fixture requires npm bundled with the current Node.js installation.");
    const run = (executable: string, args: string[], cwd: string, commandEnvironment = environment): Promise<Result> => new Promise((resolve, reject) => {
      const child = crossSpawn(executable, args, { cwd, env: commandEnvironment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      children.add(child);
      let stdout = "";
      let stderr = "";
      let failure: Error | undefined;
      const timer = setTimeout(() => {
        failure = new Error(`Acceptance command timed out: ${path.basename(executable)} ${args.join(" ")}`);
        void terminate(child).catch((error: unknown) => { failure = new Error("Cannot terminate acceptance process tree.", { cause: error }); child.kill("SIGKILL"); });
      }, 120_000);
      child.stdout!.setEncoding("utf8");
      child.stderr!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => { stdout += chunk; process.stdout.write(chunk); });
      child.stderr!.on("data", (chunk: string) => { stderr += chunk; process.stderr.write(chunk); });
      child.once("error", (error) => { failure = error; });
      child.once("close", (status) => {
        clearTimeout(timer);
        children.delete(child);
        if (failure !== undefined) reject(failure);
        else resolve({ status, stdout, stderr });
      });
    });
    const npm = (args: string[], cwd = directory): Promise<Result> => run(process.execPath, [npmCli, ...args], cwd);
    const success = (result: Result): Result => {
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      return result;
    };
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("The registry fixture did not receive a TCP port.");
    const registry = `http://127.0.0.1:${address.port}`;
    writeFileSync(userConfiguration, [
      "registry=https://registry.npmjs.org/", `@codetreker:registry=${registry}/`,
      `cache=${cache.replaceAll("\\", "/")}`,
      "fetch-retries=0", "fetch-timeout=30000", "ignore-scripts=true", "progress=false",
      "audit=false", "fund=false", "update-notifier=false", "loglevel=warn", "",
    ].join("\n"));
    const npmConfigurationContents = readFileSync(userConfiguration, "utf8");
    const sourceManifest = JSON.parse(readFileSync(path.join(packageDirectory, "package.json"), "utf8")) as Manifest;
    const versions: Record<string, Manifest> = {};
    const tarballs = new Map<string, Buffer>();
    const requests: { pathname: string; status: number }[] = [];
    let latest = "1.0.1";
    let advanceLatestAfterQuery = false;
    let metadataFailure = false;
    let tarballFailure = false;
    server.on("request", (request, response) => {
      const pathname = decodeURIComponent(new URL(request.url!, registry).pathname);
      const reply = (status: number, body: string | Buffer, contentType = "application/json"): void => {
        requests.push({ pathname, status });
        response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
        response.end(body);
      };
      if (pathname === `/${packageName}`) {
        if (metadataFailure) reply(503, JSON.stringify({ error: "Controlled registry metadata failure" }));
        else {
          reply(200, JSON.stringify({ _id: packageName, name: packageName, "dist-tags": { latest }, versions }));
          if (advanceLatestAfterQuery) { latest = "1.0.2"; advanceLatestAfterQuery = false; }
        }
        return;
      }
      const tarball = tarballs.get(pathname);
      if (tarball !== undefined) {
        if (tarballFailure) reply(503, JSON.stringify({ error: "Controlled registry tarball failure" }));
        else reply(200, tarball, "application/octet-stream");
        return;
      }
      reply(404, JSON.stringify({ error: "The fixture only serves daynight metadata and its packed tarballs." }));
    });
    for (const version of ["1.0.0", "1.0.1", "1.0.2"]) {
      const fixture = path.join(directory, `package ${version}`);
      mkdirSync(fixture);
      cpSync(path.join(packageDirectory, "dist"), path.join(fixture, "dist"), { recursive: true });
      const manifest = { ...sourceManifest, version };
      writeFileSync(path.join(fixture, "package.json"), JSON.stringify(manifest, null, 2));
      const packed = success(await npm(["pack", "--ignore-scripts", "--pack-destination", artifacts], fixture));
      expect(packed.stdout.trim()).toBe(`codetreker-daynight-${version}.tgz`);
      const tarball = readFileSync(path.join(artifacts, packed.stdout.trim()));
      const pathname = `/tarballs/daynight-${version}.tgz`;
      tarballs.set(pathname, tarball);
      versions[version] = { ...manifest, dist: {
        tarball: `${registry}${pathname}`, integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
        shasum: createHash("sha1").update(tarball).digest("hex"),
      } };
    }
    rmSync(cache, { recursive: true, force: true });
    const oldTarball = path.join(artifacts, "codetreker-daynight-1.0.0.tgz");
    success(await npm(["install", oldTarball, "--global", "--prefix", prefix, "--engine-strict", "--force=false", "--no-audit", "--no-fund"]));
    const installedPackage = process.platform === "win32" ? path.join(prefix, "node_modules", packageName) : path.join(prefix, "lib/node_modules", packageName);
    const installedBin = process.platform === "win32" ? path.join(prefix, "daynight.cmd") : path.join(prefix, "bin/daynight");
    const cli = (args: string[], commandEnvironment = environment): Promise<Result> => run(installedBin, args, caller, commandEnvironment);
    expect(success(await cli(["--version"])).stdout.trim()).toBe("1.0.0");
    const emptyHome = path.join(directory, "empty home 中文");
    mkdirSync(emptyHome);
    expect(success(await cli(["update", "--help"], { ...environment, HOME: emptyHome, USERPROFILE: emptyHome })).stdout).toContain("Usage: daynight update");
    expect(existsSync(path.join(emptyHome, ".daynight"))).toBe(false);
    const metadata = success(await npm(["view", `${packageName}@latest`, "version", "--json", "--global", "--prefix", prefix, "--prefer-online"], caller));
    const queriedVersion: unknown = JSON.parse(metadata.stdout);
    expect(Array.isArray(queriedVersion) ? queriedVersion : [queriedVersion]).toEqual(["1.0.1"]);
    advanceLatestAfterQuery = true;
    const upgraded = success(await cli(["update"]));
    expect(upgraded.stdout).toContain("Updated daynight from 1.0.0 to 1.0.1.\nRestart any running reviewer to use the new version.\n");
    expect(success(await cli(["--version"])).stdout.trim()).toBe("1.0.1");
    expect(latest).toBe("1.0.2");
    expect((JSON.parse(readFileSync(path.join(installedPackage, "package.json"), "utf8")) as Manifest).version).toBe("1.0.1");
    expect(requests.filter((item) => item.pathname === "/tarballs/daynight-1.0.1.tgz" && item.status === 200)).toHaveLength(1);
    const downloads = requests.filter((item) => item.pathname.startsWith("/tarballs/")).length;
    latest = "1.0.1";
    expect(success(await cli(["update"], { ...environment, HOME: emptyHome, USERPROFILE: emptyHome })).stdout).toBe("daynight 1.0.1 is already up to date.\n");
    expect(existsSync(path.join(emptyHome, ".daynight"))).toBe(false);
    expect(requests.filter((item) => item.pathname.startsWith("/tarballs/"))).toHaveLength(downloads);
    latest = "1.0.0";
    expect(success(await cli(["update"])).stdout).toBe("daynight 1.0.1 is newer than latest 1.0.0.\n");
    expect(requests.filter((item) => item.pathname.startsWith("/tarballs/"))).toHaveLength(downloads);
    metadataFailure = true;
    const unavailable = await cli(["update"]);
    expect(unavailable.status).toBe(1);
    expect(unavailable.stderr).toContain("Controlled registry metadata failure");
    expect(success(await cli(["--version"])).stdout.trim()).toBe("1.0.1");
    metadataFailure = false;
    latest = "1.0.2";
    tarballFailure = true;
    const failedInstall = await cli(["update"]);
    expect(failedInstall.status).toBe(1);
    expect(failedInstall.stderr).toContain("Controlled registry tarball failure");
    expect(requests.some((item) => item.pathname === "/tarballs/daynight-1.0.2.tgz" && item.status === 503)).toBe(true);
    expect(success(await cli(["--version"])).stdout.trim()).toBe("1.0.1");
    expect(readFileSync(path.join(state, "config.yml"), "utf8")).toBe(configurationContents);
    expect(readFileSync(path.join(state, "state.sqlite"))).toEqual(databaseContents);
    expect(readdirSync(state).sort()).toEqual(["config.yml", "state.sqlite"]);
    expect(readFileSync(userConfiguration, "utf8")).toBe(npmConfigurationContents);
    expect(readFileSync(globalConfiguration, "utf8")).toBe("");
    expect(readFileSync(projectConfiguration, "utf8")).toBe(projectContents);
    expect(existsSync(unrelatedPrefix)).toBe(false);
    expect(existsSync(path.join(caller, "node_modules"))).toBe(false);
    expect(requests.every((item) => item.pathname === `/${packageName}` || item.pathname.startsWith("/tarballs/"))).toBe(true);
    const npmVersion = success(await npm(["--version"])).stdout.trim();
    writeFileSync(evidenceFile, JSON.stringify({
      success: true, sourcePackageVersion: sourceManifest.version, nodeVersion: process.version, npmVersion,
      npmViewVersionShape: Array.isArray(queriedVersion) ? "singleton-array" : "string",
      platform: process.platform, architecture: process.arch, packagePacked: true,
      fixtureVersions: ["1.0.0", "1.0.1", "1.0.2"], installation: "real npm global", registry: "controlled scoped HTTP registry",
      installedBin: path.relative(prefix, installedBin).replaceAll("\\", "/"), npmCli: "current Node.js installation outside updated package",
      packagePrefix: "original npm prefix 中文", conflictingDefaultPrefixIgnored: true, callerProjectConfigurationIgnored: true,
      userNpmConfigurationPreserved: true, reviewConfigurationAndStateUnchanged: true, runtimeScripts: "disabled by isolated npm user configuration",
      scenarios: ["npm-global-shim-before-update", "spaces-and-unicode-prefix", "same-installation-replacement", "resolved-target-pinned-after-latest-moves", "npm-global-shim-after-update",
        "configured-scoped-registry", "conflicting-default-prefix", "conflicting-caller-project-npmrc", "update-help-without-state",
        "invalid-review-state-untouched", "already-current-without-install", "ahead-without-downgrade", "metadata-failure-visible", "installation-failure-visible"],
      receipts: { previousVersion: "1.0.0", updatedVersion: "1.0.1", finalVersion: "1.0.1", currentSkippedInstall: true,
        aheadSkippedInstall: true, resolvedTargetPinnedAfterLatestMoves: true, metadataFailureExitCode: unavailable.status, installFailureExitCode: failedInstall.status,
        metadataRequests: requests.filter((item) => item.pathname === `/${packageName}`).length,
        successfulUpdateTarballRequests: requests.filter((item) => item.pathname === "/tarballs/daynight-1.0.1.tgz" && item.status === 200).length },
    }, null, 2));
  } finally {
    await Promise.all([...children].map(terminate));
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => {
      if (error !== undefined && "code" in error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    }));
    rmSync(directory, { recursive: true, force: true });
  }
}, 180_000);
