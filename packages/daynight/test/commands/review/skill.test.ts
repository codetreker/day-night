import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareReviewSkill, validateReviewSkillDiscovery } from "../../../src/commands/review/skill.js";
import type { PreparedReviewSkill } from "../../../src/commands/review/skill.js";

const entrypoint = "---\nname: daynight-review\ndescription: Review pull requests managed by Daynight.\n---\n\nRead references/evidence.md.\n";
const pluginManifest = '{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"daynight-review-bundle","version":"1.0.0"}\n';
const exec = promisify(execFile);
let temporaryDirectory: string;

beforeAll(async () => {
  const taskTemporaryDirectory = fileURLToPath(new URL("../../../../../.tmp/", import.meta.url));
  await mkdir(taskTemporaryDirectory, { recursive: true });
  temporaryDirectory = await mkdtemp(path.join(taskTemporaryDirectory, "review-skill-tests-"));
});

afterAll(async () => { await rm(temporaryDirectory, { recursive: true, force: true }); });

const fixture = async (files: [string, string | Buffer][] = [
  ["SKILL.md", entrypoint],
  ["references/evidence.md", "Trace the caller.\n"],
  ["references/nested/data.bin", Buffer.from([0, 255, 7, 13, 10])],
]): Promise<{ packageDirectory: string; cacheDirectory: string; sourceDirectory: string }> => {
  const directory = await mkdtemp(path.join(temporaryDirectory, "fixture-"));
  const packageDirectory = path.join(directory, "installed package 用户");
  const cacheDirectory = path.join(directory, "cache 用户, review");
  const sourceDirectory = path.join(packageDirectory, "dist", "commands", "review", "skills", "daynight-review");
  await mkdir(sourceDirectory, { recursive: true });
  for (const [relativePath, contents] of files) {
    const destination = path.join(sourceDirectory, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  return { packageDirectory, cacheDirectory, sourceDirectory };
};

const prepareFixture = async (): Promise<{ skill: PreparedReviewSkill; packageDirectory: string; cacheDirectory: string; sourceDirectory: string }> => {
  const files = await fixture();
  return { ...files, skill: await prepareReviewSkill(files.packageDirectory, files.cacheDirectory) };
};

describe("packaged review skill snapshots", () => {
  it("copies every nested resource and keeps the complete captured bundle after the source changes", async () => {
    const { skill, sourceDirectory } = await prepareFixture();
    expect(skill).toEqual({
      name: "daynight-review",
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      rootDirectory: path.dirname(path.dirname(skill.directory)),
      directory: path.join(skill.rootDirectory, "skills", "daynight-review"),
      entrypoint: path.join(skill.directory, "SKILL.md"),
    });
    expect(await readFile(skill.entrypoint, "utf8")).toBe(entrypoint);
    expect(await readdir(skill.rootDirectory)).toEqual(["plugin.json", "skills"]);
    expect(await readdir(path.join(skill.rootDirectory, "skills"))).toEqual([skill.name]);
    expect(await readFile(path.join(skill.rootDirectory, "plugin.json"), "utf8")).toBe(pluginManifest);
    expect(await readFile(path.join(skill.directory, "references/evidence.md"), "utf8")).toBe("Trace the caller.\n");
    expect(await readFile(path.join(skill.directory, "references/nested/data.bin"))).toEqual(Buffer.from([0, 255, 7, 13, 10]));
    await writeFile(path.join(sourceDirectory, "SKILL.md"), "replacement installation");
    await rm(path.join(sourceDirectory, "references"), { recursive: true });
    expect(await readFile(skill.entrypoint, "utf8")).toBe(entrypoint);
    expect(await readFile(path.join(skill.rootDirectory, "plugin.json"), "utf8")).toBe(pluginManifest);
    expect(await readFile(path.join(skill.directory, "references/nested/data.bin"))).toEqual(Buffer.from([0, 255, 7, 13, 10]));
  });

  it("prepares a native plugin wrapper under a comma-containing cache path", async () => {
    const { skill, packageDirectory, cacheDirectory } = await prepareFixture();
    expect(skill.rootDirectory).toContain("cache 用户, review");
    expect(await readFile(path.join(skill.rootDirectory, "plugin.json"), "utf8")).toBe(pluginManifest);
    expect(await prepareReviewSkill(packageDirectory, cacheDirectory)).toEqual(skill);
  });

  it("hashes normalized paths and bytes independently of creation order and installation location", async () => {
    const files: [string, string][] = [["SKILL.md", entrypoint], ["z.md", "last"], ["a/a.md", "first"]];
    const first = await fixture(files);
    const second = await fixture(files.toReversed());
    const firstSkill = await prepareReviewSkill(first.packageDirectory, first.cacheDirectory);
    const secondSkill = await prepareReviewSkill(second.packageDirectory, second.cacheDirectory);
    expect(secondSkill.digest).toBe(firstSkill.digest);
    await writeFile(path.join(second.sourceDirectory, "a/a.md"), "different bytes");
    const changedBytes = await prepareReviewSkill(second.packageDirectory, second.cacheDirectory);
    expect(changedBytes.digest).not.toBe(firstSkill.digest);
    await writeFile(path.join(second.sourceDirectory, "a/a.md"), "first");
    await rm(path.join(second.sourceDirectory, "z.md"));
    await writeFile(path.join(second.sourceDirectory, "renamed.md"), "last");
    expect((await prepareReviewSkill(second.packageDirectory, second.cacheDirectory)).digest).not.toBe(firstSkill.digest);
    expect(await readFile(firstSkill.entrypoint, "utf8")).toBe(entrypoint);
  });

  it("retains empty directories in the content-addressed snapshot", async () => {
    const files = await fixture();
    const before = await prepareReviewSkill(files.packageDirectory, files.cacheDirectory);
    await mkdir(path.join(files.sourceDirectory, "empty"));
    const after = await prepareReviewSkill(files.packageDirectory, files.cacheDirectory);
    expect(after.digest).not.toBe(before.digest);
    expect((await lstat(path.join(after.directory, "empty"))).isDirectory()).toBe(true);
  });

  it("reuses an exact snapshot without rewriting it and supports concurrent preparation", async () => {
    const files = await fixture();
    const [first, concurrent] = await Promise.all([
      prepareReviewSkill(files.packageDirectory, files.cacheDirectory),
      prepareReviewSkill(files.packageDirectory, files.cacheDirectory),
    ]);
    expect(concurrent).toEqual(first);
    const before = await stat(first.entrypoint, { bigint: true });
    expect(await prepareReviewSkill(files.packageDirectory, files.cacheDirectory)).toEqual(first);
    const after = await stat(first.entrypoint, { bigint: true });
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(after.ino).toBe(before.ino);
    expect(await readdir(path.dirname(first.rootDirectory))).toEqual([first.digest]);
  });

  it("preserves the missing installed bundle cause before creating cache resources", async () => {
    const files = await fixture();
    await rm(files.sourceDirectory, { recursive: true });
    await expect(prepareReviewSkill(files.packageDirectory, files.cacheDirectory)).rejects.toMatchObject({
      message: expect.stringContaining("Cannot capture installed review skill bundle"),
      cause: { code: "ENOENT", path: files.sourceDirectory },
    });
    await expect(lstat(files.cacheDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["missing frontmatter", "# Review\n"],
    ["wrong name", "---\nname: other\ndescription: Review\n---\n"],
    ["empty description", "---\nname: daynight-review\ndescription: ' '\n---\n"],
    ["nonstring description", "---\nname: daynight-review\ndescription: 1\n---\n"],
    ["invalid YAML", "---\nname: daynight-review\ndescription: [\n---\n"],
    ["duplicate keys", "---\nname: daynight-review\nname: daynight-review\ndescription: Review\n---\n"],
    ["unsupported tags", "---\nname: daynight-review\ndescription: !unknown Review\n---\n"],
    ["unresolved aliases", "---\nname: daynight-review\ndescription: *unknown\n---\n"],
    ["nonmapping frontmatter", "---\n- daynight-review\n---\n"],
    ["invalid UTF-8", Buffer.from([255])],
  ])("rejects %s", async (_name, contents) => {
    const files = await fixture([["SKILL.md", contents]]);
    await expect(prepareReviewSkill(files.packageDirectory, files.cacheDirectory)).rejects.toThrow("Cannot capture installed review skill bundle");
    await expect(lstat(files.cacheDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires SKILL.md to be a file", async () => {
    const files = await fixture([]);
    await expect(prepareReviewSkill(files.packageDirectory, files.cacheDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("regular SKILL.md") } });
    await mkdir(path.join(files.sourceDirectory, "SKILL.md"));
    await expect(prepareReviewSkill(files.packageDirectory, files.cacheDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("regular SKILL.md") } });
  });

  it.skipIf(process.platform === "win32")("rejects symbolic links to files, directories and the bundle root", async () => {
    for (const target of ["SKILL.md", "references"]) {
      const files = await fixture();
      await symlink(path.join(files.sourceDirectory, target), path.join(files.sourceDirectory, "linked"));
      await expect(prepareReviewSkill(files.packageDirectory, files.cacheDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("symbolic links") } });
    }
    const files = await fixture();
    const actualDirectory = path.join(path.dirname(files.sourceDirectory), "actual");
    await mkdir(actualDirectory);
    await rm(files.sourceDirectory, { recursive: true });
    await symlink(actualDirectory, files.sourceDirectory);
    await expect(prepareReviewSkill(files.packageDirectory, files.cacheDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("symbolic links") } });
  });

  it.skipIf(process.platform === "win32")("rejects special files without opening them", async () => {
    const files = await fixture();
    await exec("mkfifo", [path.join(files.sourceDirectory, "named-pipe")], { timeout: 5_000 });
    await expect(prepareReviewSkill(files.packageDirectory, files.cacheDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("only regular files and directories") } });
  });

  it.skipIf(process.platform === "win32")("rejects path segments that cannot be normalized portably", async () => {
    const files = await fixture();
    await writeFile(path.join(files.sourceDirectory, "misleading\\path.md"), "resource");
    await expect(prepareReviewSkill(files.packageDirectory, files.cacheDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("invalid path segment") } });
  });

  it.each(["changed", "missing", "extra file", "extra directory", "missing directory", "wrong type", "extra root entry"])("rejects %s snapshot contents without overwriting the corruption", async (kind) => {
    const { skill, packageDirectory, cacheDirectory } = await prepareFixture();
    const resource = path.join(skill.directory, "references/evidence.md");
    if (kind === "changed") {
      await writeFile(resource, "corrupt");
    } else if (kind === "missing") {
      await rm(resource);
    } else if (kind === "extra file") {
      await writeFile(path.join(skill.directory, "extra.md"), "extra");
    } else if (kind === "extra directory") {
      await mkdir(path.join(skill.directory, "extra"));
    } else if (kind === "missing directory") {
      await rm(path.join(skill.directory, "references"), { recursive: true });
    } else if (kind === "wrong type") {
      await rm(resource);
      await mkdir(resource);
    } else {
      await writeFile(path.join(skill.rootDirectory, "extra.md"), "extra");
    }
    await expect(prepareReviewSkill(packageDirectory, cacheDirectory)).rejects.toThrow("Cannot prepare review skill snapshot");
    if (kind === "changed") {
      expect(await readFile(resource, "utf8")).toBe("corrupt");
    }
    expect(await readdir(path.dirname(skill.rootDirectory))).toEqual([skill.digest]);
  });

  it("rejects a preexisting empty digest directory without replacing it", async () => {
    const { skill, packageDirectory, cacheDirectory } = await prepareFixture();
    await rm(skill.rootDirectory, { recursive: true });
    await mkdir(skill.rootDirectory);
    await expect(prepareReviewSkill(packageDirectory, cacheDirectory)).rejects.toThrow("Cannot prepare review skill snapshot");
    expect(await readdir(skill.rootDirectory)).toEqual([]);
  });

  it.each(["changed manifest", "missing manifest", "manifest directory", "extra wrapper skill", "missing skills", "file skills"])("rejects %s in the generated plugin wrapper", async (kind) => {
    const { skill, packageDirectory, cacheDirectory } = await prepareFixture();
    const manifest = path.join(skill.rootDirectory, "plugin.json");
    const skillsDirectory = path.join(skill.rootDirectory, "skills");
    if (kind === "changed manifest") {
      await writeFile(manifest, pluginManifest.replace("1.0.0", "2.0.0"));
    } else if (kind === "missing manifest") {
      await rm(manifest);
    } else if (kind === "manifest directory") {
      await rm(manifest);
      await mkdir(manifest);
    } else if (kind === "extra wrapper skill") {
      await mkdir(path.join(skillsDirectory, "unexpected"));
    } else {
      await rm(skillsDirectory, { recursive: true });
      if (kind === "file skills") {
        await writeFile(skillsDirectory, "not a directory");
      }
    }
    await expect(prepareReviewSkill(packageDirectory, cacheDirectory)).rejects.toThrow("Cannot prepare review skill snapshot");
    expect(await readdir(path.dirname(skill.rootDirectory))).toEqual([skill.digest]);
  });

  it.skipIf(process.platform === "win32")("rejects symlinked plugin manifests and intermediate skills directories", async () => {
    const { skill, packageDirectory, cacheDirectory } = await prepareFixture();
    const manifest = path.join(skill.rootDirectory, "plugin.json");
    const actualManifest = path.join(cacheDirectory, "manifest.json");
    await writeFile(actualManifest, pluginManifest);
    await rm(manifest);
    await symlink(actualManifest, manifest);
    await expect(prepareReviewSkill(packageDirectory, cacheDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("symbolic links") } });
    await rm(manifest);
    await writeFile(manifest, pluginManifest);
    await rm(path.join(skill.rootDirectory, "skills"), { recursive: true });
    const actualSkills = path.join(cacheDirectory, "actual-skills");
    await mkdir(actualSkills);
    await symlink(actualSkills, path.join(skill.rootDirectory, "skills"));
    await expect(prepareReviewSkill(packageDirectory, cacheDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("symbolic links") } });
  });

  it.skipIf(process.platform === "win32")("rejects symlinked snapshot contents and roots", async () => {
    const { skill, packageDirectory, cacheDirectory, sourceDirectory } = await prepareFixture();
    const resource = path.join(skill.directory, "references/evidence.md");
    await rm(resource);
    await symlink(path.join(sourceDirectory, "references/evidence.md"), resource);
    await expect(prepareReviewSkill(packageDirectory, cacheDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("symbolic links") } });
    await rm(skill.rootDirectory, { recursive: true });
    const elsewhere = path.join(cacheDirectory, "elsewhere");
    await mkdir(elsewhere);
    await symlink(elsewhere, skill.rootDirectory);
    await expect(prepareReviewSkill(packageDirectory, cacheDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("symbolic links") } });
  });
});

describe("native Copilot skill discovery", () => {
  const discovery = (skill: PreparedReviewSkill): Record<string, unknown> => ({
    name: skill.name,
    description: "Review pull requests managed by Daynight.",
    source: "plugin",
    path: skill.directory,
    enabled: true,
  });

  it("accepts the exact prepared skill and unrelated builtin locations", async () => {
    const { skill } = await prepareFixture();
    await expect(validateReviewSkillDiscovery(JSON.stringify([
      { name: "builtin", path: "builtin://skill", enabled: true },
      discovery(skill),
    ]), skill)).resolves.toBeUndefined();
  });

  it.each(["", "not JSON", "[", "null", "{}", '"text"', "1"])("rejects malformed or nonarray discovery output %j", async (output) => {
    const { skill } = await prepareFixture();
    await expect(validateReviewSkillDiscovery(output, skill)).rejects.toThrow("Copilot skill discovery");
  });

  it("rejects missing and duplicate matching entries", async () => {
    const { skill } = await prepareFixture();
    await expect(validateReviewSkillDiscovery("[]", skill)).rejects.toThrow("found 0");
    await expect(validateReviewSkillDiscovery(JSON.stringify([{ name: "other" }]), skill)).rejects.toThrow("found 0");
    await expect(validateReviewSkillDiscovery(JSON.stringify([discovery(skill), discovery(skill)]), skill)).rejects.toThrow("found 2");
  });

  it.each([null, 1, {}, [], { name: "" }, { name: 1 }])("rejects malformed array entries %j even beside a valid match", async (entry) => {
    const { skill } = await prepareFixture();
    await expect(validateReviewSkillDiscovery(JSON.stringify([discovery(skill), entry]), skill)).rejects.toThrow("malformed skill entry");
  });

  it.each([false, undefined, "true", 1])("rejects a skill whose enabled field is %j", async (enabled) => {
    const { skill } = await prepareFixture();
    await expect(validateReviewSkillDiscovery(JSON.stringify([{ ...discovery(skill), enabled }]), skill)).rejects.toThrow("must be enabled");
  });

  it.each([undefined, null, "", " ", "relative/skill", "\0", 1])("rejects an invalid matching entry path %j", async (discoveredPath) => {
    const { skill } = await prepareFixture();
    await expect(validateReviewSkillDiscovery(JSON.stringify([{ ...discovery(skill), path: discoveredPath }]), skill)).rejects.toThrow("absolute directory path");
  });

  it("rejects project shadowing and preserves missing path errors", async () => {
    const { skill } = await prepareFixture();
    const shadow = path.join(temporaryDirectory, "project-skill");
    await mkdir(shadow, { recursive: true });
    await expect(validateReviewSkillDiscovery(JSON.stringify([{ ...discovery(skill), source: "project", path: shadow }]), skill)).rejects.toThrow("expected");
    await expect(validateReviewSkillDiscovery(JSON.stringify([{ ...discovery(skill), path: path.join(shadow, "missing") }]), skill)).rejects.toMatchObject({
      message: expect.stringContaining("Cannot resolve discovered"),
      cause: { code: "ENOENT" },
    });
    await expect(validateReviewSkillDiscovery(JSON.stringify([{ ...discovery(skill), path: skill.entrypoint }]), skill)).rejects.toThrow("expected");
  });

  it.skipIf(process.platform === "win32")("compares physical directory identity when a discovered path is an alias", async () => {
    const { skill } = await prepareFixture();
    const alias = path.join(path.dirname(skill.rootDirectory), "alias");
    await symlink(skill.directory, alias);
    await expect(validateReviewSkillDiscovery(JSON.stringify([{ ...discovery(skill), path: alias }]), skill)).resolves.toBeUndefined();
  });
});
