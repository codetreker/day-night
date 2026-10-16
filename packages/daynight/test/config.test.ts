import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { configurationDefaults, loadConfiguration, parseConfiguration } from "../src/config.js";
import { resolveRuntimePaths } from "../src/paths.js";
import * as filesystemPaths from "../src/paths.js";
import { formatError } from "../src/cli.js";

const posixPaths = resolveRuntimePaths("/home/Review User 用户", path.posix);
const repositoryYaml = (remote = "https://github.com/OWNER/REPO.git", localPath = "../code/Repo 用户"): string =>
  `repositories:\n  - remote: ${JSON.stringify(remote)}\n    path: ${JSON.stringify(localPath)}\n`;
const parse = (source: string) => parseConfiguration(source, posixPaths, path.posix);

describe("YAML configuration", () => {
  it("applies numeric defaults only when absent and resolves paths relative to the configuration", () => {
    expect(parse(repositoryYaml())).toEqual({
      ...configurationDefaults,
      repositories: [{
        coordinate: "github.com/owner/repo",
        host: "github.com",
        owner: "owner",
        name: "repo",
        remote: "https://github.com/OWNER/REPO.git",
        path: "/home/Review User 用户/code/Repo 用户",
      }],
    });
  });

  it("retains valid explicit values and absolute clone paths", () => {
    const config = parse(`pollIntervalMs: 1\nmaxConcurrentWorker: 4\nagentTimeoutMs: 2147483647\nmaxAttempts: 7\nretryDelayMs: 123\n${repositoryYaml(undefined, "/work/Repo")}`);
    expect(config).toMatchObject({ pollIntervalMs: 1, maxConcurrentWorker: 4, agentTimeoutMs: 2_147_483_647, maxAttempts: 7, retryDelayMs: 123 });
    expect(config.repositories[0]!.path).toBe("/work/Repo");
  });

  it.each(["pollIntervalMs", "maxConcurrentWorker", "agentTimeoutMs", "maxAttempts", "retryDelayMs"])("rejects invalid explicit %s values instead of supplying defaults", (field) => {
    for (const value of ["null", "0", "-1", "1.5", '"3"', "true", ".nan", ".inf", "9007199254740992"]) {
      expect(() => parse(`${field}: ${value}\n${repositoryYaml()}`)).toThrow(`${field} must be a positive safe integer`);
    }
  });

  it.each(["pollIntervalMs", "agentTimeoutMs", "retryDelayMs"])("rejects unsupported %s timer delays", (field) => {
    expect(() => parse(`${field}: 2147483648\n${repositoryYaml()}`)).toThrow("timer limit");
  });

  it.each([
    "",
    "null",
    "[]",
    "repositories: []",
    "repositories: null",
    "repositories: {}",
    "repositories: [null]",
    "repositories: [{remote: 1, path: ../repo}]",
    "repositories: [{remote: https://github.com/o/r}]",
    "repositories: [{remote: https://github.com/o/r, path: null}]",
  ])("rejects missing or malformed configuration: %s", (source) => {
    expect(() => parse(source)).toThrow();
  });

  it.each([
    `maxConcurrentReviews: 2\n${repositoryYaml()}`,
    `extra: value\n${repositoryYaml()}`,
    `1: value\n${repositoryYaml()}`,
    "repositories: [{remote: https://github.com/o/r, path: ../repo, token: secret}]",
  ])("rejects unsupported fields", (source) => {
    expect(() => parse(source)).toThrow("unsupported field");
  });

  it.each([
    `maxAttempts: 3\nmaxAttempts: 4\n${repositoryYaml()}`,
    "repositories: [{remote: https://github.com/o/r, path: ../a, path: ../b}]",
    "repositories: [",
    `unknown: !unsupported value\n${repositoryYaml()}`,
    `${repositoryYaml()}---\n${repositoryYaml()}`,
  ])("rejects YAML errors, duplicate keys and unsupported tags", (source) => {
    try {
      parse(source);
      expect.unreachable("Invalid YAML must fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBeInstanceOf(AggregateError);
      expect(formatError(error)).toContain(posixPaths.configFile);
    }
  });

  it("reports an unresolved YAML alias through its original cause", () => {
    expect(() => parse("repositories: *missing")).toThrow("Cannot decode YAML");
  });

  it.each(["git@github.com:Owner/Repo.git", "ssh://git@GITHUB.COM/Owner/Repo", "https://GitHub.Com/Owner/Repo/", "ssh://git@github.example.test:2222/Owner/Repo.git"])("extracts a stable repository identity from %s", (remote) => {
    const repository = parse(repositoryYaml(remote)).repositories[0]!;
    expect(repository.owner).toBe("owner");
    expect(repository.name).toBe("repo");
    expect(repository.coordinate).toBe(`${repository.host}/owner/repo`);
    expect(repository.remote).toBe(remote);
  });

  it.each([
    "http://github.com/o/r",
    "file:///o/r",
    "https://token@github.com/o/r",
    "https://u:password@github.com/o/r",
    "ssh://other@github.com/o/r",
    "https://github.com/o/r?token=x",
    "https://github.com/o/r#fragment",
    "https://github.com/o/r/extra",
    "https://github.com/o/../r",
    "https://github.com/o/%72",
    "https://github.com/o/..",
    "https://github.com/o/.git",
    "https:github.com/o/r",
    "ssh://git@bad%host/o/r",
    "not a remote",
    "git@github.com:o/r/extra",
    "git@github.com:o/r?x=1",
  ])("rejects malformed or unsupported remote %s", (remote) => {
    expect(() => parse(repositoryYaml(remote))).toThrow();
  });

  it("treats protocol and case variants as duplicate repository identities", () => {
    expect(() => parse(`${repositoryYaml()}  - remote: git@GITHUB.COM:owner/repo\n    path: ../other\n`)).toThrow("duplicates repository github.com/owner/repo");
  });

  it("allows the same coordinate on distinct GitHub hosts", () => {
    const config = parse(`${repositoryYaml()}  - remote: https://github.example.test/owner/repo\n    path: ../other\n`);
    expect(config.repositories).toHaveLength(2);
  });

  it("preserves distinct HTTPS origins with nondefault ports", () => {
    const config = parse(`${repositoryYaml("https://github.example.test:8443/Owner/Repo.git")}  - remote: https://github.example.test:9443/owner/repo\n    path: ../other\n`);
    expect(config.repositories.map(({ host, coordinate }) => ({ host, coordinate }))).toEqual([
      { host: "github.example.test:8443", coordinate: "github.example.test:8443/owner/repo" },
      { host: "github.example.test:9443", coordinate: "github.example.test:9443/owner/repo" },
    ]);
  });

  it("treats the explicit default HTTPS port as the same repository origin", () => {
    expect(() => parse(`${repositoryYaml("https://github.example.test:443/Owner/Repo.git")}  - remote: https://github.example.test/owner/repo\n    path: ../other\n`)).toThrow("duplicates repository github.example.test/owner/repo");
  });

  it("excludes the SSH transport port from the API host and coordinate", () => {
    const remote = "ssh://git@github.example.test:2222/Owner/Repo.git";
    const repository = parse(repositoryYaml(remote)).repositories[0]!;
    expect(repository).toMatchObject({ host: "github.example.test", coordinate: "github.example.test/owner/repo", remote });
    expect(() => parse(`${repositoryYaml(remote)}  - remote: https://github.example.test/owner/repo\n    path: ../other\n`)).toThrow("duplicates repository github.example.test/owner/repo");
  });

  it("does not interpret an SSH transport port as a nondefault HTTPS origin", () => {
    const config = parse(`${repositoryYaml("ssh://git@github.example.test:8443/owner/repo")}  - remote: https://github.example.test:8443/owner/repo\n    path: ../other\n`);
    expect(config.repositories.map(({ host }) => host)).toEqual(["github.example.test", "github.example.test:8443"]);
  });

  it("rejects duplicate clone paths after relative normalization", () => {
    expect(() => parse(`${repositoryYaml(undefined, "../code/repo")}  - remote: https://github.com/owner/other\n    path: ../code/one/../repo\n`)).toThrow("same location");
  });

  it.each([".", "..", "./clones/repo", "/home/Review User 用户"])("rejects clone/state overlap for %s", (localPath) => {
    expect(() => parse(repositoryYaml(undefined, localPath))).toThrow("must not overlap");
  });

  it("allows a similarly named sibling of the state directory", () => {
    expect(parse(repositoryYaml(undefined, "../.daynight-repo")).repositories[0]!.path).toBe("/home/Review User 用户/.daynight-repo");
  });

  it("rejects tilde paths with an actionable diagnostic", () => {
    expect(() => parse(repositoryYaml(undefined, "~/repo"))).toThrow("absolute path or a config-directory-relative path");
  });

  it("uses Windows config-relative paths and rejects exact lexical collisions", () => {
    const windowsPaths = resolveRuntimePaths("C:\\Users\\Review User 用户", path.win32);
    const config = parseConfiguration(repositoryYaml(undefined, "..\\Code\\Repo 用户"), windowsPaths, path.win32);
    expect(config.repositories[0]!.path).toBe("C:\\Users\\Review User 用户\\Code\\Repo 用户");
    expect(() => parseConfiguration(`${repositoryYaml(undefined, "C:\\Code\\Repo")}  - remote: https://github.com/o/other\n    path: C:/Code/Repo\n`, windowsPaths, path.win32)).toThrow("same location");
    expect(() => parseConfiguration(repositoryYaml(undefined, "C:/Users/Review User 用户/.daynight/repo"), windowsPaths, path.win32)).toThrow("must not overlap");
    expect(parseConfiguration(`${repositoryYaml(undefined, "C:\\Code\\Repo")}  - remote: https://github.com/o/other\n    path: C:/Code/repo\n`, windowsPaths, path.win32).repositories).toHaveLength(2);
    for (const localPath of ["C:repo", "C:"]) {
      expect(() => parseConfiguration(repositoryYaml(undefined, localPath), windowsPaths, path.win32)).toThrow("drive-relative");
    }
  });
});

describe("configuration loading", () => {
  let directory: string;
  beforeAll(async () => {
    const temporaryDirectory = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
    await mkdir(temporaryDirectory, { recursive: true });
    directory = await mkdtemp(path.join(temporaryDirectory, "config-tests-"));
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  it("retains ENOENT and the exact missing configuration path", async () => {
    const paths = resolveRuntimePaths(path.join(directory, "missing"));
    await expect(loadConfiguration(paths)).rejects.toMatchObject({
      message: `Cannot read configuration file ${paths.configFile}.`,
      cause: { code: "ENOENT", path: paths.configFile },
    });
  });

  it("loads a real YAML file without creating a clone or runtime files", async () => {
    const home = path.join(directory, "home with 空格");
    const paths = resolveRuntimePaths(home);
    await mkdir(paths.stateDirectory, { recursive: true });
    const source = repositoryYaml();
    await writeFile(paths.configFile, source);
    const probe = vi.spyOn(filesystemPaths, "isFilesystemCaseSensitive");
    try {
      const config = await loadConfiguration(paths);
      expect(config.repositories[0]!.path).toBe(path.join(home, "code", "Repo 用户"));
      expect(probe).not.toHaveBeenCalled();
      expect(await readdir(home)).toEqual([".daynight"]);
    } finally {
      probe.mockRestore();
    }
    await expect(readFile(paths.databaseFile)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(paths.configFile, "utf8")).toBe(source);
  });

  it("rejects a clone path reaching state through an existing symlink ancestor", async () => {
    const home = path.join(directory, "symlink-home");
    const paths = resolveRuntimePaths(home);
    await mkdir(paths.stateDirectory, { recursive: true });
    await symlink(paths.stateDirectory, path.join(home, "alias"), "junction");
    await writeFile(paths.configFile, repositoryYaml(undefined, "../alias/not-created/repo"));
    await expect(loadConfiguration(paths)).rejects.toThrow("must not overlap");
  });

  it("rejects distinct repository paths that resolve to the same directory", async () => {
    const home = path.join(directory, "duplicate-home");
    const paths = resolveRuntimePaths(home);
    const actual = path.join(home, "actual");
    await mkdir(paths.stateDirectory, { recursive: true });
    await mkdir(actual);
    await symlink(actual, path.join(home, "alias"), "junction");
    await writeFile(paths.configFile, `${repositoryYaml(undefined, "../actual/not-created")}  - remote: https://github.com/o/other\n    path: ../alias/not-created\n`);
    await expect(loadConfiguration(paths)).rejects.toThrow("same location");
  });

  it("rejects case-variant missing destinations using the physical ancestor's insensitive semantics", async () => {
    const home = path.join(directory, "insensitive-home");
    const paths = resolveRuntimePaths(home);
    const ancestor = path.join(home, "Code");
    await mkdir(paths.stateDirectory, { recursive: true });
    await mkdir(ancestor);
    await writeFile(paths.configFile, `${repositoryYaml(undefined, "../Code/New/Repo")}  - remote: https://github.com/o/other\n    path: ../Code/new/repo\n`);
    const probe = vi.spyOn(filesystemPaths, "isFilesystemCaseSensitive").mockResolvedValue(false);
    try {
      await expect(loadConfiguration(paths)).rejects.toThrow("same location");
      expect(probe).toHaveBeenCalledExactlyOnceWith(ancestor);
    } finally {
      probe.mockRestore();
    }
    expect(await readdir(ancestor)).toEqual([]);
  });

  it("accepts case-distinct missing destinations on a sensitive filesystem and caches its probe", async () => {
    const home = path.join(directory, "sensitive-home");
    const paths = resolveRuntimePaths(home);
    const ancestor = path.join(home, "Code");
    await mkdir(paths.stateDirectory, { recursive: true });
    await mkdir(ancestor);
    await writeFile(paths.configFile, `${repositoryYaml(undefined, "../Code/New/Repo")}  - remote: https://github.com/o/other\n    path: ../Code/new/repo\n  - remote: https://github.com/o/third\n    path: ../Code/NEW/REPO\n`);
    const probe = vi.spyOn(filesystemPaths, "isFilesystemCaseSensitive").mockResolvedValue(true);
    try {
      expect((await loadConfiguration(paths)).repositories).toHaveLength(3);
      expect(probe).toHaveBeenCalledExactlyOnceWith(ancestor);
    } finally {
      probe.mockRestore();
    }
    expect(await readdir(ancestor)).toEqual([]);
  });

  it("uses native filesystem lookup rules for missing destinations and removes its temporary probe", async () => {
    const home = path.join(directory, "native-case-home 用户");
    const paths = resolveRuntimePaths(home);
    await mkdir(paths.stateDirectory, { recursive: true });
    const reference = path.join(home, "CaseReference");
    await mkdir(reference);
    const originalReference = await lstat(reference, { bigint: true });
    let caseSensitive: boolean;
    try {
      const alternate = await lstat(path.join(home, "casereference"), { bigint: true });
      caseSensitive = originalReference.dev !== alternate.dev || originalReference.ino !== alternate.ino;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
      caseSensitive = true;
    }
    await writeFile(paths.configFile, `${repositoryYaml(undefined, "../New/Repo")}  - remote: https://github.com/o/other\n    path: ../new/repo\n`);
    const entries = await readdir(home);
    if (caseSensitive) {
      expect((await loadConfiguration(paths)).repositories).toHaveLength(2);
    } else {
      await expect(loadConfiguration(paths)).rejects.toThrow("same location");
    }
    expect(await readdir(home)).toEqual(entries);
  });

  it("uses physical ancestry for state overlap without probing or creating missing clone directories", async () => {
    const home = path.join(directory, "physical-state-home");
    const paths = resolveRuntimePaths(home);
    await mkdir(paths.stateDirectory, { recursive: true });
    await symlink(paths.stateDirectory, path.join(home, "STATE-ALIAS"), "junction");
    await writeFile(paths.configFile, repositoryYaml(undefined, "../STATE-ALIAS/New/Repo"));
    const probe = vi.spyOn(filesystemPaths, "isFilesystemCaseSensitive");
    try {
      await expect(loadConfiguration(paths)).rejects.toThrow("must not overlap");
      expect(probe).not.toHaveBeenCalled();
    } finally {
      probe.mockRestore();
    }
    expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
  });

  it("exposes filesystem failures rather than treating a file as a missing directory", async () => {
    const home = path.join(directory, "bad-ancestor");
    const paths = resolveRuntimePaths(home);
    await mkdir(paths.stateDirectory, { recursive: true });
    await writeFile(path.join(home, "not-directory"), "file");
    await writeFile(paths.configFile, repositoryYaml(undefined, "../not-directory/repo"));
    try {
      await loadConfiguration(paths);
      expect.unreachable("A regular file cannot be a clone directory ancestor.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(formatError(error)).toContain(path.join(home, "not-directory"));
      expect(formatError(error)).toMatch(/not a directory|ENOTDIR/);
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });

  it("rejects an existing regular file at the configured clone path", async () => {
    const home = path.join(directory, "file-target");
    const paths = resolveRuntimePaths(home);
    const clonePath = path.join(home, "repo");
    await mkdir(paths.stateDirectory, { recursive: true });
    await writeFile(clonePath, "file");
    await writeFile(paths.configFile, repositoryYaml(undefined, "../repo"));
    await expect(loadConfiguration(paths)).rejects.toThrow(`Filesystem path ${clonePath} is not a directory.`);
  });
});
