import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareRelease, publishRelease, runNpmPublish } from "../scripts/publish.js";
import type { ReleaseReceipt, ReleaseServices } from "../scripts/publish.js";

const root = path.resolve(import.meta.dirname, "../../../.tmp/publish-tests");
const script = path.resolve(import.meta.dirname, "../scripts/publish.ts");
const sourceSha = "a".repeat(40);
const otherSha = "b".repeat(40);
const bytes = Buffer.from("exact prepared package bytes");
const hash = (value: Uint8Array) => `sha512-${createHash("sha512").update(value).digest("base64")}`;
const directories: string[] = [];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const fixture = () => {
  mkdirSync(root, { recursive: true });
  const cwd = mkdtempSync(path.join(root, "release "));
  directories.push(cwd);
  const artifact = path.join(cwd, ".tmp/npm-release/artifact");
  mkdirSync(artifact, { recursive: true });
  const receipt: ReleaseReceipt = {
    name: "@codetreker/daynight", version: "1.2.3", sourceSha, integrity: hash(bytes),
    tarball: "package.tgz", tag: "daynight-v1.2.3", repository: "codetreker/daynight",
  };
  const save = () => writeFileSync(path.join(artifact, "release.json"), JSON.stringify(receipt));
  save();
  writeFileSync(path.join(artifact, "package.tgz"), bytes);
  return { cwd, artifact, receipt, save };
};
type Metadata = { name: string; version: string; gitHead: string; dist: { integrity: string; tarball: string } };
const metadata = (receipt: ReleaseReceipt): Metadata => ({
  name: receipt.name, version: receipt.version, gitHead: receipt.sourceSha,
  dist: { integrity: receipt.integrity, tarball: "https://registry.npmjs.org/@codetreker/daynight/-/daynight-1.2.3.tgz" },
});
const harness = (receipt: ReleaseReceipt) => {
  const state: {
    metadata: Metadata | undefined; latest: unknown; tag: string | undefined; tarball: Uint8Array;
    postStatus: number; publicationError: Error | undefined; delay: number;
  } = { metadata: undefined, latest: { version: "1.2.2" }, tag: undefined, tarball: bytes, postStatus: 201, publicationError: undefined, delay: 0 };
  const events: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.startsWith("https://api.github.com/")) {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-github-token");
      if (init?.method === "POST") {
        events.push("tag:create");
        expect(JSON.parse(String(init.body))).toEqual({ ref: `refs/tags/${receipt.tag}`, sha: receipt.sourceSha });
        if (state.postStatus !== 201) return json({}, state.postStatus);
        state.tag = receipt.sourceSha;
        return json({ ref: `refs/tags/${receipt.tag}`, object: { type: "commit", sha: state.tag } }, 201);
      }
      events.push("tag:lookup");
      return state.tag === undefined ? json({}, 404) : json({ object: { type: "commit", sha: state.tag } });
    }
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    if (url.endsWith("/latest")) { events.push("registry:latest"); return state.latest === undefined ? json({}, 404) : json(state.latest); }
    if (url.endsWith(".tgz")) { events.push("tarball:download"); return new Response(Buffer.from(state.tarball)); }
    events.push("registry:version");
    if (state.delay > 0) { state.delay--; return json({}, 404); }
    return state.metadata === undefined ? json({}, 404) : json(state.metadata);
  });
  const publish = vi.fn(async () => {
    events.push("npm:publish");
    if (state.publicationError !== undefined) throw state.publicationError;
    state.metadata = metadata(receipt);
  });
  const wait = vi.fn(async () => { events.push("wait"); });
  const services: ReleaseServices = { fetch: fetchMock as typeof fetch, publish, wait, token: "test-github-token", apiUrl: "https://api.github.com" };
  return { state, events, services, publish, wait, fetchMock };
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("npm release publication", () => {
  it("publishes the prepared artifact, waits for anonymous registry availability, verifies downloaded bytes, then tags its source", async () => {
    const f = fixture();
    const h = harness(f.receipt);
    h.state.delay = 3;
    await publishRelease(sourceSha, f.cwd, h.services);
    expect(h.publish).toHaveBeenCalledExactlyOnceWith(path.join(f.artifact, "package.tgz"), path.join(f.cwd, ".tmp/npm-release"));
    expect(h.wait).toHaveBeenCalledTimes(2);
    expect(h.state.tag).toBe(sourceSha);
    expect(h.events.indexOf("npm:publish")).toBeLessThan(h.events.indexOf("tarball:download"));
    expect(h.events.indexOf("tarball:download")).toBeLessThan(h.events.indexOf("tag:create"));
  });

  it("preserves publication failure and never tags an unsuccessful publication", async () => {
    const f = fixture();
    const h = harness(f.receipt);
    const failure = new Error("npm rejected OIDC credentials");
    h.state.publicationError = failure;
    await expect(publishRelease(sourceSha, f.cwd, h.services)).rejects.toBe(failure);
    expect(h.events).not.toContain("tag:create");
  });

  it("recovers a completed publication after tag creation fails without publishing again or changing npm latest", async () => {
    const f = fixture();
    const h = harness(f.receipt);
    h.state.postStatus = 403;
    await expect(publishRelease(sourceSha, f.cwd, h.services)).rejects.toThrow("tag creation failed: HTTP 403");
    expect(h.publish).toHaveBeenCalledTimes(1);
    h.state.postStatus = 201;
    h.state.latest = { version: "9.0.0" };
    await publishRelease(sourceSha, f.cwd, h.services);
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect(h.events.filter((event) => event === "registry:latest")).toHaveLength(1);
    expect(h.state.tag).toBe(sourceSha);
  });

  it.each(["source", "integrity"])("rejects existing version with mismatched %s before publication or tagging", async (field) => {
    const f = fixture();
    const h = harness(f.receipt);
    h.state.metadata = metadata(f.receipt);
    if (field === "source") h.state.metadata.gitHead = otherSha;
    else h.state.metadata.dist.integrity = hash(Buffer.from("another package"));
    await expect(publishRelease(sourceSha, f.cwd, h.services)).rejects.toThrow("differs from the prepared source or tarball integrity");
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.events).not.toContain("tag:create");
  });

  it("rejects altered public tarball bytes even when registry metadata matches", async () => {
    const f = fixture();
    const h = harness(f.receipt);
    h.state.metadata = metadata(f.receipt);
    h.state.tarball = Buffer.from("wrong public bytes");
    await expect(publishRelease(sourceSha, f.cwd, h.services)).rejects.toThrow("Public npm tarball bytes differ");
    expect(h.events).not.toContain("tag:create");
  });

  it("preserves a conflicting existing tag and fails before npm publication", async () => {
    const f = fixture();
    const h = harness(f.receipt);
    h.state.tag = otherSha;
    await expect(publishRelease(sourceSha, f.cwd, h.services)).rejects.toThrow("already points to a different target");
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.state.tag).toBe(otherSha);
  });

  it("accepts an existing matching tag only after verifying the public package", async () => {
    const f = fixture();
    const h = harness(f.receipt);
    h.state.tag = sourceSha;
    h.state.metadata = metadata(f.receipt);
    await publishRelease(sourceSha, f.cwd, h.services);
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.events).toContain("tarball:download");
    expect(h.events).not.toContain("tag:create");
  });

  it.each([sourceSha, otherSha])("handles concurrent tag creation by accepting only the same source (%s)", async (concurrentSha) => {
    const f = fixture();
    const h = harness(f.receipt);
    h.state.metadata = metadata(f.receipt);
    const original = h.services.fetch;
    h.services.fetch = (async (input, init) => {
      if (init?.method === "POST") { h.state.tag = concurrentSha; return json({}, 422); }
      return original(input, init);
    }) as typeof fetch;
    const result = publishRelease(sourceSha, f.cwd, h.services);
    if (concurrentSha === sourceSha) await expect(result).resolves.toEqual(f.receipt);
    else await expect(result).rejects.toThrow("already points to a different target");
    expect(h.state.tag).toBe(concurrentSha);
  });

  it.each(["1.2.3", "1.2.4", "2.0.0", "1.2.4-beta.1"])("rejects publishing a new version behind or equal to latest %s", async (latest) => {
    const f = fixture();
    const h = harness(f.receipt);
    h.state.latest = { version: latest };
    await expect(publishRelease(sourceSha, f.cwd, h.services)).rejects.toThrow();
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("supports an initially absent package and compares stable version components numerically", async () => {
    const f = fixture();
    const h = harness(f.receipt);
    f.receipt.version = "1.10.0";
    f.receipt.tag = "daynight-v1.10.0";
    f.save();
    h.state.latest = { version: "1.9.999" };
    await publishRelease(sourceSha, f.cwd, h.services);
    h.state.metadata = undefined;
    h.state.tag = undefined;
    h.state.latest = undefined;
    await publishRelease(sourceSha, f.cwd, h.services);
    expect(h.publish).toHaveBeenCalledTimes(2);
  });

  it("bounds persistent registry 404 propagation and never creates a tag on timeout", async () => {
    const f = fixture();
    const h = harness(f.receipt);
    h.services.publish = async () => { h.events.push("npm:publish"); };
    await expect(publishRelease(sourceSha, f.cwd, h.services)).rejects.toThrow("within 120 seconds");
    expect(h.wait).toHaveBeenCalledTimes(24);
    expect(h.events.filter((event) => event === "registry:version")).toHaveLength(26);
    expect(h.events).not.toContain("tag:create");
  });

  it.each([401, 429, 500])("exposes registry HTTP %s instead of interpreting it as an absent version", async (status) => {
    const f = fixture();
    const h = harness(f.receipt);
    const original = h.services.fetch;
    h.services.fetch = (async (input, init) => String(input).startsWith("https://registry.npmjs.org/") ? json({}, status) : original(input, init)) as typeof fetch;
    await expect(publishRelease(sourceSha, f.cwd, h.services)).rejects.toThrow(`HTTP ${status}`);
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.events).not.toContain("tag:create");
  });

  it("preserves network errors and request time bounds", async () => {
    const f = fixture();
    const h = harness(f.receipt);
    const failure = new Error("registry connection reset");
    const original = h.services.fetch;
    h.services.fetch = (async (input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (String(input).startsWith("https://registry.npmjs.org/")) throw failure;
      return original(input, init);
    }) as typeof fetch;
    await expect(publishRelease(sourceSha, f.cwd, h.services)).rejects.toBe(failure);
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("rejects tampered local artifacts before making external requests", async () => {
    const f = fixture();
    const h = harness(f.receipt);
    writeFileSync(path.join(f.artifact, "package.tgz"), "tampered");
    await expect(publishRelease(sourceSha, f.cwd, h.services)).rejects.toThrow("Prepared tarball integrity differs");
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it.each(["name", "version", "sourceSha", "repository", "tag", "tarball", "integrity"])("rejects invalid receipt field %s before any external request", async (field) => {
    const f = fixture();
    const h = harness(f.receipt);
    writeFileSync(path.join(f.artifact, "release.json"), JSON.stringify({ ...f.receipt, [field]: "invalid" }));
    await expect(publishRelease(sourceSha, f.cwd, h.services)).rejects.toThrow("Release receipt does not match");
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

const packedManifest = (tarball: Buffer): Record<string, unknown> => {
  const tar = gunzipSync(tarball);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, "");
    const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, "").trim(), 8);
    if (name === "package/package.json") return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString()) as Record<string, unknown>;
    if (!Number.isFinite(size)) break;
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("No manifest in package tarball.");
};

describe("release preparation and command wrappers", () => {
  it("packs authored metadata and built output with the exact source gitHead and a matching receipt", async () => {
    const f = fixture();
    const app = path.join(f.cwd, "packages/daynight");
    mkdirSync(path.join(app, "dist"), { recursive: true });
    mkdirSync(path.join(app, "node_modules/private-package"), { recursive: true });
    writeFileSync(path.join(app, "dist/main.js"), "console.log('release');\n");
    writeFileSync(path.join(app, "README.md"), "# Package\n");
    writeFileSync(path.join(app, "package.json"), JSON.stringify({
      name: "@codetreker/daynight", version: "1.2.3", files: ["dist"],
      repository: { type: "git", url: "git+https://github.com/codetreker/daynight.git", directory: "packages/daynight" },
      scripts: { prepack: "node -e \"process.exit(91)\"" },
    }));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: f.cwd, encoding: "utf8", timeout: 20_000 }).trim();
    git("init", "--initial-branch=main");
    const tree = execFileSync("git", ["mktree"], { cwd: f.cwd, input: "", encoding: "utf8" }).trim();
    const sha = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], {
      cwd: f.cwd, encoding: "utf8", input: `tree ${tree}\nauthor Fixture <fixture@example.invalid> 1700000000 +0000\ncommitter Fixture <fixture@example.invalid> 1700000000 +0000\n\nRelease fixture\n`,
    }).trim();
    git("update-ref", "refs/heads/main", sha);
    await expect(prepareRelease(otherSha, f.cwd)).rejects.toThrow("differs from release source");
    const receipt = await prepareRelease(sha, f.cwd);
    const tarball = readFileSync(path.join(f.artifact, "package.tgz"));
    expect(receipt.sourceSha).toBe(sha);
    expect(receipt.integrity).toBe(hash(tarball));
    expect(packedManifest(tarball)).toMatchObject({ name: "@codetreker/daynight", version: "1.2.3", gitHead: sha });
    expect(gunzipSync(tarball).includes(Buffer.from("package/dist/main.js"))).toBe(true);
    expect(gunzipSync(tarball).includes(Buffer.from("package/README.md"))).toBe(true);
    expect(readFileSync(path.join(app, "package.json"), "utf8")).not.toContain("gitHead");
    expect(readFileSync(path.join(f.artifact, "release.json"), "utf8")).toBe(`${JSON.stringify(receipt, null, 2)}\n`);
  });

  it("runs an explicit npm CLI through Node, strips token/config fallbacks, and forwards nonzero status", async () => {
    const f = fixture();
    const cli = path.join(f.cwd, "npm-cli.mjs");
    const output = path.join(f.cwd, "invocation.json");
    writeFileSync(cli, `import {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(output)}, JSON.stringify({args: process.argv.slice(2), token: process.env.NODE_AUTH_TOKEN, config: process.env.npm_config_registry}));\nprocess.exit(17);\n`);
    vi.stubEnv("NPM_CLI_JS", cli);
    vi.stubEnv("NODE_AUTH_TOKEN", "must-not-reach-npm");
    vi.stubEnv("npm_config_registry", "https://wrong.invalid");
    await expect(runNpmPublish(path.join(f.artifact, "package.tgz"), f.cwd)).rejects.toThrow("npm publish failed (exit 17)");
    const invocation = JSON.parse(readFileSync(output, "utf8")) as { args: string[]; token?: string; config?: string };
    expect(invocation.token).toBeUndefined();
    expect(invocation.config).toBeUndefined();
    expect(invocation.args).toEqual(expect.arrayContaining(["publish", path.join(f.artifact, "package.tgz"), "--access=public", "--tag=latest", "--provenance", "--ignore-scripts", "--registry=https://registry.npmjs.org/"]));
    expect(readFileSync(path.join(f.cwd, "user.npmrc"), "utf8")).toBe("");
  });

  it("rejects unsupported CLI commands and missing source arguments", () => {
    for (const args of [[], ["publish"], ["unknown", sourceSha], ["prepare", sourceSha, "extra"]]) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", timeout: 20_000 });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Usage:");
    }
  });
});
