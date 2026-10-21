import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { Server } from "node:http";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const workspace = path.resolve(import.meta.dirname, "../../../..");
const goImage = "golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61";
const postgresImage = "postgres:18.6-bookworm@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650";
const databaseName = "native_skill";

export type NativeServiceObservation = {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly status: number | null;
};

export type NativeServiceCleanup = {
  readonly serverStopped: boolean;
  readonly sessionsRemaining: number;
  readonly containerRemoved: boolean;
  readonly proxyStopped: boolean;
  readonly builderRemoved: boolean;
  readonly filesRemoved: boolean;
};

export type NativeService = {
  readonly url: string;
  readonly identity: {
    readonly goVersion: string;
    readonly postgresVersion: string;
    readonly binarySha256: string;
  };
  readonly observations: readonly NativeServiceObservation[];
  cleanup(): Promise<NativeServiceCleanup>;
};

type CommandResult = { stdout: string; stderr: string };
type ServiceExit = { code: number | null; signal: NodeJS.Signals | null };
type MutableObservation = { method: string; path: string; query: Record<string, string>; status: number | null };

export const runNativeServiceCommand = async (
  operation: string,
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; stream?: boolean } = {},
): Promise<CommandResult> => {
  const { terminateInstalledProcess }: typeof import("../fixtures/installed-cli.js") = await import(new URL("../fixtures/installed-cli.ts", import.meta.url).href);
  const child = spawn(command, [...args], { cwd: options.cwd ?? workspace, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  let stdout = "", stderr = "";
  let launchFailure: Error | undefined;
  child.once("error", (error) => { launchFailure = error; });
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; if (options.stream) process.stdout.write(chunk); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; if (options.stream) process.stderr.write(chunk); });
  const closed = new Promise<ServiceExit>((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([closed, new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), options.timeoutMs ?? 30_000); })]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
  if (result === "timeout") {
    const failure = new Error(`${operation} exceeded its deadline.`);
    try { await terminateInstalledProcess(child, closed); }
    catch (cleanupError) { throw new AggregateError([failure, cleanupError], `${operation} timed out and process cleanup failed.`); }
    throw failure;
  }
  if (launchFailure !== undefined) throw new Error(`${operation} could not start.`, { cause: launchFailure });
  if (result.code !== 0 || result.signal !== null) throw new Error(`${operation} failed (${result.signal ?? `exit ${String(result.code)}`}).`, { cause: new Error(stderr.trim()) });
  return { stdout, stderr };
};

const run = runNativeServiceCommand;

const waitFor = async <T>(operation: string, promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${operation} exceeded its deadline.`)), timeoutMs); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
};

const makeDirectoriesWritable = async (directory: string): Promise<void> => {
  const entry = await lstat(directory);
  if (!entry.isDirectory()) return;
  await chmod(directory, entry.mode | 0o700);
  for (const child of await readdir(directory)) await makeDirectoriesWritable(path.join(directory, child));
};

const observeQuery = (query: URLSearchParams): Record<string, string> => Object.fromEntries(
  [...query].map(([key, value]) => {
    if (key === "cursor") return [key, "present"];
    if (key === "limit" && /^[0-9]+$/.test(value) || key === "ready" && /^(true|false)$/.test(value) || key === "status" && /^(todo|in_progress|done)$/.test(value)) return [key, value];
    return [key, "redacted"];
  }),
);

export const createNativeService = async (rootDirectory: string): Promise<NativeService> => {
  if (process.platform !== "linux") throw new Error("Native Agent service acceptance requires Linux and Docker.");
  if (!path.isAbsolute(rootDirectory)) throw new Error("Native service root must be an absolute task directory.");
  const temporary = path.join(workspace, ".tmp");
  const relative = path.relative(temporary, rootDirectory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Native service root must be inside the workspace .tmp directory.");
  await mkdir(rootDirectory, { recursive: true });
  const root = await mkdtemp(path.join(rootDirectory, "service-"));
  const suffix = randomUUID();
  const label = `daynight.native-skill.run=${suffix}`;
  const postgresName = `daynight-native-pg-${suffix}`;
  const builderName = `daynight-native-go-${suffix}`;
  const applicationName = `native_skill_${suffix.replaceAll("-", "")}`;
  const password = randomBytes(32).toString("hex");
  const observations: MutableObservation[] = [];
  let server: ChildProcess | undefined;
  let serverClosed: Promise<ServiceExit> | undefined;
  let serverExit: ServiceExit | undefined;
  let started = false;
  let proxy: Server | undefined;
  let logOverflow = false;
  let unsafeLog = false;
  let logFailure: Error | undefined;
  let cleanupPromise: Promise<NativeServiceCleanup> | undefined;

  const containerExists = async (name: string): Promise<boolean> => (await run("Inspect owned container", "docker", ["container", "ls", "--all", "--filter", `name=^/${name}$`, "--filter", `label=${label}`, "--format", "{{.ID}}"])).stdout.trim() !== "";
  const removeContainer = async (name: string): Promise<boolean> => {
    if (await containerExists(name)) await run("Remove owned container", "docker", ["rm", "--force", name]);
    return !await containerExists(name);
  };
  const cleanup = (): Promise<NativeServiceCleanup> => cleanupPromise ??= (async () => {
    const failures: unknown[] = [];
    let serverStopped = server === undefined;
    let sessionsRemaining = 0;
    let containerRemoved = false;
    let proxyStopped = proxy === undefined;
    let builderRemoved = false;
    let filesRemoved = false;
    if (proxy !== undefined) {
      try {
        proxy.closeAllConnections();
        await waitFor("Native service recorder shutdown", new Promise<void>((resolve, reject) => proxy!.close((error) => error === undefined ? resolve() : reject(error))), 5_000);
        proxyStopped = true;
      } catch (error) { failures.push(error); }
    }
    if (server !== undefined && serverClosed !== undefined) {
      try {
        if (serverExit === undefined) server.kill("SIGTERM");
        try { await waitFor("Native service shutdown", serverClosed, 5_000); }
        catch (error) { server.kill("SIGKILL"); await waitFor("Native service forced process reap", serverClosed, 2_000); throw error; }
        serverStopped = true;
        if (started && (serverExit?.code !== 0 || serverExit.signal !== null)) throw new Error("Native service did not shut down cleanly.");
      } catch (error) { failures.push(error); }
    }
    try {
      if (await containerExists(postgresName)) {
        try {
          const result = await run("Count owned service database sessions", "docker", ["exec", postgresName, "psql", "-U", databaseName, "-d", databaseName, "-Atc", `SELECT count(*) FROM pg_stat_activity WHERE application_name = '${applicationName}'`]);
          if (!/^[0-9]+\n?$/.test(result.stdout)) throw new Error("PostgreSQL session count was not an integer.");
          sessionsRemaining = Number(result.stdout.trim());
          if (sessionsRemaining !== 0) throw new Error("Owned native service database sessions remain after shutdown.");
        } finally { containerRemoved = await removeContainer(postgresName); }
      } else containerRemoved = true;
    } catch (error) { failures.push(error); }
    try { builderRemoved = await removeContainer(builderName); } catch (error) { failures.push(error); }
    try { await makeDirectoriesWritable(root); await rm(root, { recursive: true, force: true }); filesRemoved = true; } catch (error) { failures.push(error); }
    if (logOverflow) failures.push(new Error("Native service logs exceeded the four MiB acceptance limit."));
    if (unsafeLog) failures.push(new Error("Native service emitted its database credential in logs."));
    if (logFailure !== undefined) failures.push(logFailure);
    if (failures.length !== 0) throw new AggregateError(failures, "Native service cleanup failed.");
    return { serverStopped, sessionsRemaining, containerRemoved, proxyStopped, builderRemoved, filesRemoved };
  })();

  try {
    const environmentDirectories = { GOCACHE: "go-cache", GOMODCACHE: "go-mod", GOPATH: "go", GOBIN: "bin", TMPDIR: "tmp", XDG_CONFIG_HOME: "config", XDG_CACHE_HOME: "cache" };
    for (const value of Object.values(environmentDirectories)) await mkdir(path.join(root, value));
    await run("Build embedded web assets", "pnpm", ["web:build"], { stream: true, timeoutMs: 120_000, env: { ...process.env, XDG_CACHE_HOME: path.join(root, "cache") } });
    const goVersion = (await run("Read cached Go toolchain version", "docker", ["run", "--rm", "--pull=never", "--name", builderName, "--label", label, goImage, "go", "version"])).stdout.trim();
    if (!/^go version go1\.27\.2 linux\//.test(goVersion)) throw new Error("Native service requires the pinned Go 1.27.2 toolchain.");
    const buildArgs = ["run", "--rm", "--pull=never", "--name", builderName, "--label", label, "--user", `${process.getuid!()}:${process.getgid!()}`, "--mount", `type=bind,source=${workspace},target=/workspace`, "--workdir", "/workspace/packages/daynight-server", "--env", "GOENV=off", "--env", "GOTOOLCHAIN=local"];
    const mountedRoot = `/workspace/${path.relative(workspace, root).split(path.sep).join("/")}`;
    for (const [key, value] of Object.entries(environmentDirectories)) buildArgs.push("--env", `${key}=${mountedRoot}/${value}`);
    buildArgs.push(goImage, "go", "build", "-o", `${mountedRoot}/daynight-server`, "./cmd/daynight-server");
    await run("Build native service", "docker", buildArgs, { stream: true, timeoutMs: 180_000 });
    const binary = path.join(root, "daynight-server");
    const binarySha256 = createHash("sha256").update(await readFile(binary)).digest("hex");
    await run("Start isolated PostgreSQL", "docker", ["run", "--detach", "--pull=never", "--name", postgresName, "--label", label, "--tmpfs", "/var/lib/postgresql:rw", "--publish", "127.0.0.1::5432", "--env", `POSTGRES_USER=${databaseName}`, "--env", `POSTGRES_DB=${databaseName}`, "--env", "POSTGRES_PASSWORD", postgresImage], { env: { ...process.env, POSTGRES_PASSWORD: password } });
    await run("Wait for isolated PostgreSQL", "docker", ["exec", postgresName, "sh", "-c", `for attempt in $(seq 1 100); do pg_isready -h 127.0.0.1 -U ${databaseName} -d ${databaseName} >/dev/null 2>&1 && exit 0; sleep 0.1; done; exit 1`], { timeoutMs: 15_000 });
    const postgresVersion = (await run("Read PostgreSQL version", "docker", ["exec", postgresName, "psql", "-U", databaseName, "-d", databaseName, "-Atc", "SHOW server_version"])).stdout.trim();
    if (!/^18\.6(?:\s|$)/.test(postgresVersion)) throw new Error("Native service requires PostgreSQL 18.6.");
    const port = (await run("Read isolated PostgreSQL port", "docker", ["port", postgresName, "5432/tcp"])).stdout.trim();
    if (!/^127\.0\.0\.1:[0-9]+$/.test(port)) throw new Error("Isolated PostgreSQL must publish one loopback port.");
    const databaseUrl = new URL(`postgres://${databaseName}:${password}@${port}/${databaseName}`);
    databaseUrl.searchParams.set("sslmode", "disable");
    databaseUrl.searchParams.set("application_name", applicationName);
    databaseUrl.searchParams.set("timezone", "UTC");
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("DAYNIGHT_")));
    server = spawn(binary, [], { cwd: root, env: { ...environment, DAYNIGHT_DATABASE_URL: databaseUrl.toString(), DAYNIGHT_LISTEN_ADDR: "127.0.0.1:0", DAYNIGHT_STARTUP_TIMEOUT: "10s", DAYNIGHT_SHUTDOWN_TIMEOUT: "2s" }, stdio: ["ignore", "pipe", "pipe"] });
    const readiness = Promise.withResolvers<string>();
    server.once("error", (error) => readiness.reject(new Error("Native service process could not start.", { cause: error })));
    serverClosed = new Promise<ServiceExit>((resolve) => server!.once("close", (code, signal) => { serverExit = { code, signal }; resolve(serverExit); readiness.reject(new Error("Native service exited before readiness.")); }));
    let pending = "", bytes = 0;
    const decoder = new StringDecoder("utf8");
    const consumeLog = (chunk: Buffer): void => {
      bytes += chunk.byteLength;
      if (bytes > 4 * 1024 * 1024) { logOverflow = true; readiness.reject(new Error("Native service log limit exceeded.")); return; }
      pending += decoder.write(chunk);
      unsafeLog ||= pending.includes(password);
      for (let newline = pending.indexOf("\n"); newline !== -1; newline = pending.indexOf("\n")) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        try {
          const event: unknown = JSON.parse(line);
          if (typeof event === "object" && event !== null && "phase" in event && event.phase === "listening" && "address" in event && typeof event.address === "string") readiness.resolve(event.address);
        } catch (cause) { logFailure = new Error("Native service emitted an invalid structured log.", { cause }); readiness.reject(logFailure); }
      }
    };
    server.stdout!.on("data", consumeLog);
    server.stderr!.on("data", consumeLog);
    const address = await waitFor("Native service readiness", readiness.promise, 15_000);
    if (!/^127\.0\.0\.1:[0-9]+$/.test(address)) throw new Error("Native service must listen on loopback.");
    const upstreamOrigin = `http://${address}`;
    const response = await fetch(`${upstreamOrigin}/api/v1/projects?limit=1`, { signal: AbortSignal.timeout(10_000) });
    const empty: unknown = await response.json();
    if (response.status !== 200 || typeof empty !== "object" || empty === null || !("items" in empty) || !Array.isArray(empty.items) || empty.items.length !== 0 || !("nextCursor" in empty) || empty.nextCursor !== null) throw new Error("Fresh native service did not return an empty complete project page.");
    started = true;
    proxy = createServer((incoming, outgoing) => {
      const url = new URL(incoming.url!, upstreamOrigin);
      if (url.origin !== upstreamOrigin) { outgoing.writeHead(400); outgoing.end(); return; }
      const observation: MutableObservation = { method: incoming.method!, path: /^\/api\/v1\/projects(?:\/[0-9a-f-]+(?:\/tasks(?:\/[0-9a-f-]+)?|\/task-graph)?)?$/.test(url.pathname) ? url.pathname : "other", query: observeQuery(url.searchParams), status: null };
      observations.push(observation);
      const upstream = request(url, { method: incoming.method, headers: { ...incoming.headers, host: url.host } }, (result) => {
        observation.status = result.statusCode!;
        outgoing.writeHead(result.statusCode!, result.headers);
        result.pipe(outgoing);
      });
      upstream.once("error", () => { observation.status = 502; outgoing.writeHead(502); outgoing.end(); });
      incoming.once("aborted", () => upstream.destroy());
      incoming.pipe(upstream);
    });
    await waitFor("Native service recorder startup", new Promise<void>((resolve, reject) => { proxy!.once("error", reject); proxy!.listen(0, "127.0.0.1", resolve); }), 5_000);
    const proxyAddress = proxy.address();
    if (typeof proxyAddress !== "object" || proxyAddress === null) throw new Error("Native service recorder did not allocate a loopback port.");
    return { url: `http://127.0.0.1:${proxyAddress.port}`, identity: { goVersion, postgresVersion, binarySha256 }, observations, cleanup };
  } catch (error) {
    try { await cleanup(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Native service startup and cleanup failed."); }
    throw error;
  }
};
