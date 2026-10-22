import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const packageName = "@codetreker/daynight";
const repository = "codetreker/daynight";
const registry = "https://registry.npmjs.org";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sourcePattern = /^[0-9a-f]{40}$/;
const publicationWindow = 600_000;
const publicationInterval = 5_000;
const publicationAttempts = publicationWindow / publicationInterval + 1;
const npmCommand = (): { command: string; prefix: string[] } => process.platform === "win32"
  ? { command: process.execPath, prefix: [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")] }
  : { command: "npm", prefix: [] };
const configuredNpmCommand = () => process.env.NPM_CLI_JS === undefined
  ? npmCommand()
  : { command: process.execPath, prefix: [process.env.NPM_CLI_JS] };

export interface ReleaseReceipt {
  name: string;
  version: string;
  sourceSha: string;
  integrity: string;
  tarball: "package.tgz";
  tag: string;
  repository: string;
}

export interface ReleaseServices {
  fetch: typeof fetch;
  npmView: (version: string, cwd: string, signal?: AbortSignal) => Promise<RecordValue | undefined>;
  publish: (tarball: string, cwd: string) => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
  token: string;
  apiUrl: string;
}

type ReleaseLookupServices = Pick<ReleaseServices, "fetch" | "npmView" | "token" | "apiUrl">;
export interface ReleasePreflight {
  version: string;
  skip: boolean;
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown, description: string): RecordValue => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Invalid ${description}.`);
  return value as RecordValue;
};
const source = (sha: string): void => {
  if (!sourcePattern.test(sha) || sha === "0".repeat(40)) throw new Error("A full lowercase 40-character source commit SHA is required.");
};
const checkedOutSource = (sha: string, cwd: string): void => {
  source(sha);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", timeout: 20_000 }).trim();
  if (head !== sha) throw new Error(`Checked out HEAD ${head} differs from release source ${sha}.`);
};
const packageManifest = async (cwd: string): Promise<RecordValue & { version: string }> => {
  const manifest = record(JSON.parse(await readFile(path.join(cwd, "packages/daynight/package.json"), "utf8")), "package manifest");
  const repo = record(manifest.repository, "package repository");
  if (manifest.name !== packageName || typeof manifest.version !== "string" || !stableVersion.test(manifest.version)
    || repo.type !== "git" || repo.url !== `git+https://github.com/${repository}.git` || repo.directory !== "packages/daynight") {
    throw new Error("Package manifest must identify @codetreker/daynight, a stable version, and its codetreker/daynight Git repository and directory.");
  }
  return manifest as RecordValue & { version: string };
};
const integrity = (bytes: Uint8Array): string => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const locations = (cwd: string) => {
  const root = path.join(cwd, ".tmp/npm-release");
  return { root, stage: path.join(root, "stage"), artifact: path.join(root, "artifact") };
};
const checkReceipt = (input: unknown, sha: string): ReleaseReceipt => {
  source(sha);
  const receipt = record(input, "release receipt");
  if (receipt.name !== packageName || typeof receipt.version !== "string" || !stableVersion.test(receipt.version)
    || receipt.sourceSha !== sha || receipt.repository !== repository || receipt.tag !== `daynight-v${receipt.version}`
    || receipt.tarball !== "package.tgz" || typeof receipt.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(receipt.integrity)) {
    throw new Error("Release receipt does not match the expected package, stable version, source, repository, tag, or tarball.");
  }
  return receipt as unknown as ReleaseReceipt;
};

export const prepareRelease = async (sha: string, cwd = process.cwd()): Promise<ReleaseReceipt> => {
  checkedOutSource(sha, cwd);
  const app = path.join(cwd, "packages/daynight");
  const manifest = await packageManifest(cwd);
  const dirs = locations(cwd);
  await rm(dirs.root, { recursive: true, force: true });
  await mkdir(dirs.artifact, { recursive: true });
  await cp(app, dirs.stage, { recursive: true, filter: (filename) => !["node_modules", ".tmp"].includes(path.basename(filename)) });
  // Packing outside the checkout requires carrying the source identity explicitly.
  await writeFile(path.join(dirs.stage, "package.json"), `${JSON.stringify({ ...manifest, gitHead: sha }, null, 2)}\n`);
  const npm = npmCommand();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npm.command, [...npm.prefix, "pack", dirs.stage, "--ignore-scripts", "--silent", "--pack-destination", dirs.artifact, `--cache=${path.join(dirs.root, "npm-cache")}`], {
      cwd, stdio: "inherit", timeout: 120_000,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`npm pack failed (${signal === null ? `exit ${code}` : `signal ${signal}`}).`)));
  });
  const packed = await readdir(dirs.artifact);
  if (packed.length !== 1 || !packed[0]!.endsWith(".tgz")) throw new Error("npm pack must produce exactly one tarball.");
  const filename = packed[0]!;
  await rename(path.join(dirs.artifact, filename), path.join(dirs.artifact, "package.tgz"));
  const receipt: ReleaseReceipt = {
    name: packageName, version: manifest.version, sourceSha: sha,
    integrity: integrity(await readFile(path.join(dirs.artifact, "package.tgz"))),
    tarball: "package.tgz", tag: `daynight-v${manifest.version}`, repository,
  };
  await writeFile(path.join(dirs.artifact, "release.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Prepared ${receipt.name}@${receipt.version} from ${sha}.`);
  return receipt;
};

export const runNpmPublish = async (tarball: string, cwd: string): Promise<void> => {
  const emptyUserConfig = path.join(cwd, "user.npmrc");
  const emptyGlobalConfig = path.join(cwd, "global.npmrc");
  await writeFile(emptyUserConfig, "");
  await writeFile(emptyGlobalConfig, "");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key) && !/^(NODE_AUTH_TOKEN|NPM_TOKEN)$/i.test(key)));
  const args = ["publish", tarball, "--access=public", "--tag=latest", "--provenance", "--ignore-scripts", `--registry=${registry}/`, `--userconfig=${emptyUserConfig}`, `--globalconfig=${emptyGlobalConfig}`, `--cache=${path.join(cwd, "npm-cache")}`];
  const npm = configuredNpmCommand();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npm.command, [...npm.prefix, ...args], {
      cwd, env, stdio: "inherit", timeout: 180_000,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`npm publish failed (${signal === null ? `exit ${code}` : `signal ${signal}`}).`)));
  });
};

export const runNpmView = async (version: string, cwd: string, signal?: AbortSignal): Promise<RecordValue | undefined> => {
  const subject = `${packageName}@${version}`;
  const deadline = AbortSignal.timeout(30_000);
  const requestSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
  const npm = configuredNpmCommand();
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(npm.command, [...npm.prefix, "view", subject, "--json", "--registry", registry, `--cache=${path.join(cwd, ".tmp/npm-view-cache")}`], {
      cwd, stdio: ["ignore", "pipe", "pipe"], signal: requestSignal, killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => { failure = new Error(`npm view ${subject} failed.`, { cause: requestSignal.aborted ? requestSignal.reason : error }); });
    child.once("close", (code) => failure === undefined ? resolve({ code, stdout, stderr }) : reject(failure));
  });
  if (result.code !== 0) {
    let failure: unknown;
    try { failure = JSON.parse(result.stdout); } catch { /* npm can report transport failures without JSON. */ }
    if (typeof failure === "object" && failure !== null && "error" in failure) {
      const error = failure.error;
      if (typeof error === "object" && error !== null && "code" in error && error.code === "E404") return undefined;
    }
    throw new Error(`Unable to read npm publication metadata for ${subject}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
  let input: unknown;
  try { input = JSON.parse(result.stdout); } catch (error) {
    throw new Error(`npm view ${subject} returned malformed JSON.`, { cause: error });
  }
  const metadata = record(Array.isArray(input) && input.length === 1 ? input[0] : input, `npm metadata for ${subject}`);
  if (metadata.name !== packageName || typeof metadata.version !== "string" || !stableVersion.test(metadata.version)
    || version !== "latest" && metadata.version !== version) throw new Error(`npm view returned invalid metadata for ${subject}.`);
  return metadata;
};

const defaultLookupServices = (): ReleaseLookupServices => {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token === undefined || token.length === 0) throw new Error("GITHUB_TOKEN is required to look up release tags.");
  return { fetch, npmView: runNpmView, token, apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com" };
};
const defaultServices = (): ReleaseServices => {
  return {
    ...defaultLookupServices(), publish: runNpmPublish,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
};
const request = async <T>(services: ReleaseLookupServices, url: string, read: (response: Response) => Promise<T>, init: RequestInit = {}): Promise<T> => {
  const signal = init.signal === undefined || init.signal === null ? AbortSignal.timeout(20_000) : AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]);
  signal.throwIfAborted();
  const aborted = Promise.withResolvers<never>();
  const abort = () => aborted.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([services.fetch(url, { ...init, signal }).then(read), aborted.promise]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
};
const verifyMetadata = (metadata: RecordValue, receipt: ReleaseReceipt): RecordValue => {
  const dist = record(metadata.dist, "npm distribution metadata");
  if (metadata.name !== receipt.name || metadata.version !== receipt.version || metadata.gitHead !== receipt.sourceSha || dist.integrity !== receipt.integrity) {
    throw new Error(`Published ${receipt.name}@${receipt.version} differs from the prepared source or tarball integrity.`);
  }
  return dist;
};
const compareVersions = (left: string, right: string): number => {
  if (!stableVersion.test(left) || !stableVersion.test(right)) throw new Error("The latest npm version and release version must use stable semantic versions.");
  const lhs = left.split(".").map(BigInt);
  const rhs = right.split(".").map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (lhs[index]! > rhs[index]!) return 1;
    if (lhs[index]! < rhs[index]!) return -1;
  }
  return 0;
};
const githubHeaders = (services: ReleaseLookupServices) => ({ Accept: "application/vnd.github+json", Authorization: `Bearer ${services.token}`, "X-GitHub-Api-Version": "2022-11-28" });
const tagReference = async (services: ReleaseLookupServices, tag: string): Promise<RecordValue | undefined> => {
  return request(services, `${services.apiUrl}/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`, async (response) => {
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GitHub tag lookup failed: HTTP ${response.status}.`);
    const reference = record(await response.json(), "GitHub tag reference");
    const object = record(reference.object, "GitHub tag target");
    if (reference.ref !== `refs/tags/${tag}` || typeof object.type !== "string" || object.type.length === 0
      || typeof object.sha !== "string" || !sourcePattern.test(object.sha) || object.sha === "0".repeat(40)) {
      throw new Error("GitHub returned an invalid release tag reference.");
    }
    return object;
  }, { headers: githubHeaders(services) });
};
const existingTag = async (services: ReleaseServices, receipt: ReleaseReceipt): Promise<boolean> => {
  const object = await tagReference(services, receipt.tag);
  if (object === undefined) return false;
  if (object.type !== "commit" || object.sha !== receipt.sourceSha) throw new Error(`Tag ${receipt.tag} already points to a different target.`);
  return true;
};

export const preflightRelease = async (sha: string, cwd = process.cwd(), services = defaultLookupServices()): Promise<ReleasePreflight> => {
  checkedOutSource(sha, cwd);
  const { version } = await packageManifest(cwd);
  if (await tagReference(services, `daynight-v${version}`) !== undefined) return { version, skip: true };
  const metadata = await services.npmView(version, cwd);
  return { version, skip: metadata !== undefined };
};
const createTag = async (services: ReleaseServices, receipt: ReleaseReceipt): Promise<void> => {
  if (await existingTag(services, receipt)) return;
  await request(services, `${services.apiUrl}/repos/${repository}/git/refs`, async (response) => {
    if (response.status === 422 && await existingTag(services, receipt)) return;
    if (response.status !== 201) throw new Error(`GitHub tag creation failed: HTTP ${response.status}.`);
    const result = record(await response.json(), "created GitHub tag reference");
    const object = record(result.object, "created GitHub tag target");
    if (result.ref !== `refs/tags/${receipt.tag}` || object.type !== "commit" || object.sha !== receipt.sourceSha) throw new Error("GitHub returned an unexpected release tag target.");
  }, {
    method: "POST", headers: { ...githubHeaders(services), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/tags/${receipt.tag}`, sha: receipt.sourceSha }),
  });
};

const verifyPublicPackage = async (services: ReleaseServices, receipt: ReleaseReceipt, cwd: string): Promise<void> => {
  const started = Date.now();
  const deadline = AbortSignal.timeout(publicationWindow);
  const timeoutMessage = `Timed out waiting for public npm version ${receipt.name}@${receipt.version} and tarball within 10 minutes.`;
  let tarballUrl: string | undefined;
  try {
    for (let attempt = 0; attempt < publicationAttempts; attempt++) {
      deadline.throwIfAborted();
      const elapsed = Date.now() - started;
      console.log(`Waiting for public npm version and tarball ${receipt.name}@${receipt.version}: attempt ${attempt + 1}/${publicationAttempts}, elapsed ${Math.floor(elapsed / 1_000)}s, remaining ${Math.ceil(Math.max(0, publicationWindow - elapsed) / 1_000)}s.`);
      if (tarballUrl === undefined) {
        const metadata = await services.npmView(receipt.version, cwd, deadline);
        if (metadata !== undefined) {
          const dist = verifyMetadata(metadata, receipt);
          if (typeof dist.tarball !== "string") throw new Error("Published npm metadata has no tarball URL.");
          const url = new URL(dist.tarball);
          if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org") throw new Error("Published tarball URL must use the public npm registry.");
          tarballUrl = url.href;
        }
      }
      if (tarballUrl !== undefined) {
        const verified = await request(services, tarballUrl, async (response) => {
          if (response.status === 404) return false;
          if (!response.ok) throw new Error(`Public npm tarball download failed: HTTP ${response.status}.`);
          if (integrity(new Uint8Array(await response.arrayBuffer())) !== receipt.integrity) throw new Error("Public npm tarball bytes differ from the prepared artifact.");
          return true;
        }, { signal: deadline });
        deadline.throwIfAborted();
        if (verified) return;
      }
      if (attempt + 1 < publicationAttempts) await services.wait(Math.min(publicationInterval, Math.max(0, publicationWindow - (Date.now() - started))));
    }
  } catch (error) {
    if (deadline.aborted) throw new Error(timeoutMessage, { cause: error });
    throw error;
  }
  throw new Error(timeoutMessage);
};

export const publishRelease = async (sha: string, cwd = process.cwd(), services = defaultServices()): Promise<ReleaseReceipt> => {
  const dirs = locations(cwd);
  const receipt = checkReceipt(JSON.parse(await readFile(path.join(dirs.artifact, "release.json"), "utf8")), sha);
  const skip = () => {
    console.log(`Skipping existing release ${receipt.name}@${receipt.version}.`);
    return receipt;
  };
  if (await tagReference(services, receipt.tag) !== undefined || await services.npmView(receipt.version, cwd) !== undefined) return skip();
  const latest = await services.npmView("latest", cwd);
  if (latest?.version === receipt.version) return skip();
  if (latest !== undefined && (typeof latest.version !== "string" || compareVersions(latest.version, receipt.version) >= 0)) {
    throw new Error(`Publishing ${receipt.version} would not advance npm latest (${String(latest.version)}).`);
  }
  const tarball = path.join(dirs.artifact, receipt.tarball);
  if (integrity(await readFile(tarball)) !== receipt.integrity) throw new Error("Prepared tarball integrity differs from the release receipt.");
  try {
    await services.publish(tarball, dirs.root);
  } catch (error) {
    let metadata: RecordValue | undefined;
    try { metadata = await services.npmView(receipt.version, cwd); } catch (lookupError) {
      throw new AggregateError([error, lookupError], `npm publish failed and the publication status of ${receipt.name}@${receipt.version} could not be checked.`, { cause: error });
    }
    if (metadata !== undefined) return skip();
    throw error;
  }
  await verifyPublicPackage(services, receipt, cwd);
  await createTag(services, receipt);
  console.log(`Verified ${receipt.name}@${receipt.version}; tag ${receipt.tag} points to ${receipt.sourceSha}.`);
  return receipt;
};

if (import.meta.main) {
  const [command, sha, ...extra] = process.argv.slice(2);
  if ((command !== "preflight" && command !== "prepare" && command !== "publish") || sha === undefined || extra.length !== 0) {
    throw new Error("Usage: node packages/daynight/scripts/publish.ts <preflight|prepare|publish> <source-sha>");
  }
  if (command === "preflight") {
    const result = await preflightRelease(sha);
    console.log(`${result.skip ? "Skipping existing" : "Preparing new"} release ${packageName}@${result.version}.`);
    if (process.env.GITHUB_OUTPUT !== undefined) await appendFile(process.env.GITHUB_OUTPUT, `version=${result.version}\nskip=${result.skip}\n`);
  } else if (command === "prepare") await prepareRelease(sha);
  else await publishRelease(sha);
}
