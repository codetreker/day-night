import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import which from "which";
import type { NativeHostRequest } from "./host.js";
import { nativeRecord, runNativeProcess } from "./copilot-process.js";

const workspace = resolve(import.meta.dirname, "../../../..");
const image = "golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61";
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export type ClaudeContainer = {
  readonly identity: {
    readonly image: string;
    readonly binarySha256: string;
    readonly bubblewrapVersion: string;
    readonly bubblewrapSha256: string;
    readonly hostUid: number;
    readonly claudeAmbientCapabilities: string;
    readonly containerCapabilitiesAdded: string;
    readonly containerSecurityOptions: string;
    readonly subprocessCredentialScrubVerified: true;
  };
  run(arguments_: readonly string[], options: {
    environment: NodeJS.ProcessEnv;
    input?: string;
    timeoutMs: number;
    onJson?: (event: Record<string, unknown>) => void;
  }): Promise<string>;
  cleanup(): Promise<void>;
};

export const createClaudeContainer = async (
  request: NativeHostRequest,
  environment: NodeJS.ProcessEnv,
  redact: (value: string) => string,
): Promise<ClaudeContainer> => {
  if (process.platform !== "linux" || process.getuid === undefined || process.getgid === undefined) throw new Error("Claude native credential isolation requires Linux and Docker.");
  const fixture = relative(join(workspace, ".tmp"), request.fixtureDirectory);
  if (fixture === ".." || fixture.startsWith("../") || isAbsolute(fixture)) throw new Error("Claude container fixture must be inside the task workspace .tmp directory.");
  const binary = await realpath(await which("claude", { path: process.env.PATH }));
  const gh = await realpath(await which("gh", { path: process.env.PATH }));
  const node = await realpath(process.execPath);
  const ghConfig = environment.GH_CONFIG_DIR;
  if (ghConfig === undefined || !isAbsolute(ghConfig)) throw new Error("Claude native execution requires an explicit read-only GitHub configuration directory.");
  const suffix = randomUUID();
  const name = `daynight-native-claude-${suffix}`;
  const label = `daynight.native-claude.run=${suffix}`;
  const probe = join(request.stateDirectory, "claude-runtime-probe");
  let cleanupPromise: Promise<void> | undefined;
  const docker = (arguments_: readonly string[], options: {
    environment?: NodeJS.ProcessEnv;
    input?: string;
    timeoutMs?: number;
    onJson?: (event: Record<string, unknown>) => void;
  } = {}): Promise<string> => runNativeProcess({
    executable: "docker", arguments: arguments_, cwd: request.workingDirectory,
    environment: options.environment ?? request.environment,
    timeoutMs: options.timeoutMs ?? 30_000, redact,
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.onJson === undefined ? {} : { onJson: options.onJson }),
  });
  const exists = async (): Promise<boolean> => (await docker(["container", "ls", "--all", "--filter", `name=^/${name}$`, "--filter", `label=${label}`, "--format", "{{.ID}}"])) !== "";
  const cleanup = (): Promise<void> => cleanupPromise ??= (async () => {
    const failures: unknown[] = [];
    try {
      if (await exists()) await docker(["rm", "--force", name]);
      if (await exists()) throw new Error("Owned Claude container remains after removal.");
    } catch (cause) { failures.push(cause); }
    try { await rm(probe, { recursive: true, force: true }); } catch (cause) { failures.push(cause); }
    if (failures.length !== 0) throw new AggregateError(failures, "Claude container cleanup failed.");
  })();
  const run: ClaudeContainer["run"] = (arguments_, options) => {
    if (options.environment.PATH === undefined) throw new Error("Claude container execution requires the fixture's explicit executable path.");
    const childEnvironment = { ...options.environment, PATH: `${options.environment.PATH}:/usr/local/bin:/usr/bin:/bin` };
    const argumentsWithEnvironment = ["exec", "--interactive", "--user", `${process.getuid!()}:${process.getgid!()}`, "--workdir", request.workingDirectory];
    for (const [key, value] of Object.entries(childEnvironment)) if (value !== undefined) argumentsWithEnvironment.push("--env", key);
    // Docker reads these values from its child-only environment; credentials never enter argv or the container configuration.
    return docker([...argumentsWithEnvironment, name, "/native-tools/claude", ...arguments_], { ...options, environment: childEnvironment });
  };
  try {
    await mkdir(probe, { recursive: true });
    const mounts = [
      [workspace, workspace, true],
      [request.fixtureDirectory, request.fixtureDirectory, false],
      [binary, "/native-tools/claude", true],
      [node, process.execPath, true],
      [gh, gh, true],
      [ghConfig, ghConfig, true],
    ] as const;
    const arguments_ = ["run", "--detach", "--rm", "--pull=never", "--name", name, "--label", label,
      "--network", "host", "--cap-add", "SYS_ADMIN", "--cap-add", "NET_ADMIN", "--cap-add", "SYS_PTRACE",
      "--security-opt", "seccomp=unconfined", "--security-opt", "apparmor=unconfined"];
    for (const [source, target, readonly] of mounts) arguments_.push("--mount", `type=bind,source=${source},target=${target}${readonly ? ",readonly" : ""}`);
    arguments_.push(image, "sleep", "infinity");
    await docker(arguments_);
    // Debian's setuid bubblewrap requires this capability set; Claude itself runs as the host UID with no capabilities.
    // https://github.com/containers/bubblewrap/blob/v0.8.0/bubblewrap.c#L672-L691
    await docker(["exec", name, "sh", "-c", "set -e; apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y bubblewrap >/dev/null; chmod u+s /usr/bin/bwrap"], { timeoutMs: 120_000 });
    const bubblewrapVersion = (await docker(["exec", name, "bwrap", "--version"])).trim();
    const bubblewrapHash = await docker(["exec", name, "sha256sum", "/usr/bin/bwrap"]);
    const bubblewrapSha256 = /^([a-f0-9]{64})\s/.exec(bubblewrapHash)?.[1];
    if (bubblewrapSha256 === undefined) throw new Error("Claude container did not return its actual bubblewrap SHA-256.");
    const capabilities = await docker(["exec", "--user", `${process.getuid()}:${process.getgid()}`, name,
      "sh", "-c", "sed -n 's/^CapAmb:[[:space:]]*//p' /proc/self/status"]);
    if (!/^0+$/.test(capabilities)) throw new Error("Claude container model UID inherited ambient capabilities.");
    const namespace = await docker(["exec", "--user", `${process.getuid()}:${process.getgid()}`, name,
      "bwrap", "--unshare-user", "--bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--die-with-parent", "--new-session",
      "sh", "-c", `test "$(id -u)" = ${process.getuid()} && printf namespace-verified`]);
    if (namespace !== "namespace-verified") throw new Error("Claude container did not verify its actual bubblewrap namespace runtime.");
    const script = join(probe, "scrub.mjs"), receipt = join(probe, "scrub.json"), settings = join(probe, "settings.json");
    await writeFile(script, `import { writeFile } from 'node:fs/promises';\nawait writeFile(${JSON.stringify(receipt)}, JSON.stringify({ credentialAbsent: process.env.ANTHROPIC_AUTH_TOKEN === undefined, uid: process.getuid() }));\n`);
    await writeFile(settings, JSON.stringify({ hooks: { Setup: [{ matcher: "init", hooks: [{ type: "command", command: `${shellQuote(process.execPath)} ${shellQuote(script)}` }] }] } }));
    const syntheticEnvironment = Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith("ANTHROPIC_")));
    await run(["--init-only", "--settings", settings, "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} })], {
      environment: { ...syntheticEnvironment, ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ANTHROPIC_AUTH_TOKEN: `synthetic-${randomUUID()}` }, timeoutMs: 30_000,
    });
    const proof = nativeRecord(JSON.parse(await readFile(receipt, "utf8")));
    if (proof?.credentialAbsent !== true || proof.uid !== process.getuid()) throw new Error("Claude's actual Setup subprocess did not scrub its synthetic bearer credential at the fixture UID.");
    await rm(probe, { recursive: true, force: true });
    return { identity: {
      image, binarySha256: createHash("sha256").update(await readFile(binary)).digest("hex"),
      bubblewrapVersion, bubblewrapSha256, hostUid: process.getuid(), claudeAmbientCapabilities: capabilities,
      containerCapabilitiesAdded: "SYS_ADMIN,NET_ADMIN,SYS_PTRACE",
      containerSecurityOptions: "seccomp=unconfined,apparmor=unconfined (owned container only)",
      subprocessCredentialScrubVerified: true,
    }, run, cleanup };
  } catch (cause) {
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([cause, cleanupError], "Claude container preparation and cleanup failed."); }
    throw cause;
  }
};
