import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const packageName = "@codetreker/daynight";
const repository = "codetreker/day-night";
const registry = "https://registry.npmjs.org";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sourcePattern = /^[0-9a-f]{40}$/;
const publicationAttempts = 25;
const npmCommand = (): { command: string; prefix: string[] } => process.platform === "win32"
  ? { command: process.execPath, prefix: [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")] }
  : { command: "npm", prefix: [] };

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
  publish: (tarball: string, cwd: string) => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
  token: string;
  apiUrl: string;
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown, description: string): RecordValue => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Invalid ${description}.`);
  return value as RecordValue;
};
const source = (sha: string): void => {
  if (!sourcePattern.test(sha) || sha === "0".repeat(40)) throw new Error("A full lowercase 40-character source commit SHA is required.");
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
  source(sha);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", timeout: 20_000 }).trim();
  if (head !== sha) throw new Error(`Checked out HEAD ${head} differs from release source ${sha}.`);
  const app = path.join(cwd, "packages/daynight");
  const manifest = record(JSON.parse(await readFile(path.join(app, "package.json"), "utf8")), "package manifest");
  const repo = record(manifest.repository, "package repository");
  if (manifest.name !== packageName || typeof manifest.version !== "string" || !stableVersion.test(manifest.version)
    || repo.type !== "git" || repo.url !== `git+https://github.com/${repository}.git` || repo.directory !== "packages/daynight") {
    throw new Error("Package manifest must identify @codetreker/daynight, a stable version, and its codetreker/day-night Git repository and directory.");
  }
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
  const cli = process.env.NPM_CLI_JS;
  const npm = cli === undefined ? npmCommand() : { command: process.execPath, prefix: [cli] };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npm.command, [...npm.prefix, ...args], {
      cwd, env, stdio: "inherit", timeout: 180_000,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`npm publish failed (${signal === null ? `exit ${code}` : `signal ${signal}`}).`)));
  });
};

const defaultServices = (): ReleaseServices => {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token === undefined || token.length === 0) throw new Error("GITHUB_TOKEN is required to create the release tag.");
  return {
    fetch, publish: runNpmPublish, token, apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
};
const request = async (services: ReleaseServices, url: string, init: RequestInit = {}): Promise<Response> => services.fetch(url, {
  ...init, signal: init.signal === undefined || init.signal === null ? AbortSignal.timeout(20_000) : AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]),
});
const registryMetadata = async (services: ReleaseServices, version: string, signal?: AbortSignal): Promise<RecordValue | undefined> => {
  const response = await request(services, `${registry}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`, { headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`npm registry lookup for ${version} failed: HTTP ${response.status}.`);
  return record(await response.json(), `npm metadata for ${version}`);
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
const tagUrl = (services: ReleaseServices, receipt: ReleaseReceipt): string => `${services.apiUrl}/repos/${repository}/git/ref/tags/${encodeURIComponent(receipt.tag)}`;
const githubHeaders = (services: ReleaseServices) => ({ Accept: "application/vnd.github+json", Authorization: `Bearer ${services.token}`, "X-GitHub-Api-Version": "2022-11-28" });
const existingTag = async (services: ReleaseServices, receipt: ReleaseReceipt): Promise<boolean> => {
  const response = await request(services, tagUrl(services, receipt), { headers: githubHeaders(services) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`GitHub tag lookup failed: HTTP ${response.status}.`);
  const object = record(record(await response.json(), "GitHub tag reference").object, "GitHub tag target");
  if (object.type !== "commit" || object.sha !== receipt.sourceSha) throw new Error(`Tag ${receipt.tag} already points to a different target.`);
  return true;
};
const createTag = async (services: ReleaseServices, receipt: ReleaseReceipt): Promise<void> => {
  if (await existingTag(services, receipt)) return;
  const response = await request(services, `${services.apiUrl}/repos/${repository}/git/refs`, {
    method: "POST", headers: { ...githubHeaders(services), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/tags/${receipt.tag}`, sha: receipt.sourceSha }),
  });
  if (response.status === 422 && await existingTag(services, receipt)) return;
  if (response.status !== 201) throw new Error(`GitHub tag creation failed: HTTP ${response.status}.`);
  const result = record(await response.json(), "created GitHub tag reference");
  const object = record(result.object, "created GitHub tag target");
  if (result.ref !== `refs/tags/${receipt.tag}` || object.type !== "commit" || object.sha !== receipt.sourceSha) throw new Error("GitHub returned an unexpected release tag target.");
};

export const publishRelease = async (sha: string, cwd = process.cwd(), services = defaultServices()): Promise<ReleaseReceipt> => {
  const dirs = locations(cwd);
  const receipt = checkReceipt(JSON.parse(await readFile(path.join(dirs.artifact, "release.json"), "utf8")), sha);
  const tarball = path.join(dirs.artifact, receipt.tarball);
  if (integrity(await readFile(tarball)) !== receipt.integrity) throw new Error("Prepared tarball integrity differs from the release receipt.");
  await existingTag(services, receipt);
  let metadata = await registryMetadata(services, receipt.version);
  if (metadata === undefined) {
    const latest = await registryMetadata(services, "latest");
    if (latest !== undefined && (typeof latest.version !== "string" || compareVersions(latest.version, receipt.version) >= 0)) {
      throw new Error(`Publishing ${receipt.version} would not advance npm latest (${String(latest.version)}).`);
    }
    await services.publish(tarball, dirs.root);
    const visibilityDeadline = AbortSignal.timeout(120_000);
    for (let attempt = 0; attempt < publicationAttempts; attempt++) {
      metadata = await registryMetadata(services, receipt.version, visibilityDeadline);
      if (metadata !== undefined) break;
      if (attempt + 1 < publicationAttempts) await services.wait(5_000);
    }
    if (metadata === undefined) throw new Error(`Published version ${receipt.version} did not become publicly available within 120 seconds.`);
  }
  const dist = verifyMetadata(metadata, receipt);
  if (typeof dist.tarball !== "string") throw new Error("Published npm metadata has no tarball URL.");
  const tarballUrl = new URL(dist.tarball);
  if (tarballUrl.protocol !== "https:" || tarballUrl.hostname !== "registry.npmjs.org") throw new Error("Published tarball URL must use the public npm registry.");
  const response = await request(services, tarballUrl.href);
  if (!response.ok) throw new Error(`Public npm tarball download failed: HTTP ${response.status}.`);
  if (integrity(new Uint8Array(await response.arrayBuffer())) !== receipt.integrity) throw new Error("Public npm tarball bytes differ from the prepared artifact.");
  await createTag(services, receipt);
  console.log(`Verified ${receipt.name}@${receipt.version}; tag ${receipt.tag} points to ${receipt.sourceSha}.`);
  return receipt;
};

if (import.meta.main) {
  const [command, sha, ...extra] = process.argv.slice(2);
  if ((command !== "prepare" && command !== "publish") || sha === undefined || extra.length !== 0) {
    throw new Error("Usage: node packages/daynight/scripts/publish.ts <prepare|publish> <source-sha>");
  }
  if (command === "prepare") await prepareRelease(sha);
  else await publishRelease(sha);
}
