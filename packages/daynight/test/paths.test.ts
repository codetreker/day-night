import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isFilesystemCaseSensitive, pathsEqual, pathsOverlap, resolveRuntimePaths } from "../src/paths.js";

describe("current-user runtime paths", () => {
  it("resolves all state locations from an injected POSIX home", () => {
    expect(resolveRuntimePaths("/home/Review User 用户", path.posix)).toEqual({
      stateDirectory: "/home/Review User 用户/.daynight",
      configFile: "/home/Review User 用户/.daynight/config.yml",
      databaseFile: "/home/Review User 用户/.daynight/state.sqlite",
      lockFile: "/home/Review User 用户/.daynight/instance.lock",
      copilotDirectory: "/home/Review User 用户/.daynight/copilot",
      cacheDirectory: "/home/Review User 用户/.daynight/cache",
      temporaryDirectory: "/home/Review User 用户/.daynight/tmp",
      logsDirectory: "/home/Review User 用户/.daynight/logs",
    });
  });

  it("uses Windows path semantics without reading or changing HOME", () => {
    const paths = resolveRuntimePaths("C:\\Users\\Review User 用户", path.win32);
    expect(paths.configFile).toBe("C:\\Users\\Review User 用户\\.daynight\\config.yml");
    expect(paths.databaseFile).toBe("C:\\Users\\Review User 用户\\.daynight\\state.sqlite");
  });

  it("rejects a relative home rather than deriving state from the working directory", () => {
    expect(() => resolveRuntimePaths("relative", path.posix)).toThrow("absolute path");
  });
});

describe("path comparison", () => {
  it("distinguishes sibling names from descendants", () => {
    expect(pathsOverlap("/home/u/.daynight", "/home/u/.daynight-other", path.posix)).toBe(false);
    expect(pathsOverlap("/home/u/.daynight", "/home/u/.daynight/repo", path.posix)).toBe(true);
    expect(pathsOverlap("/home/u", "/home/u/.daynight", path.posix)).toBe(true);
  });

  it("normalizes Windows separators while leaving case semantics to filesystem validation", () => {
    expect(pathsEqual("C:\\Code\\Repo", "C:/Code/Repo/", path.win32)).toBe(true);
    expect(pathsEqual("C:\\Code\\Repo", "C:/Code/repo", path.win32)).toBe(false);
    expect(pathsOverlap("C:\\Users\\u\\.daynight", "C:/Users/u/.daynight/repo", path.win32)).toBe(true);
    expect(pathsOverlap("C:\\Users\\u\\.daynight", "C:/Users/u/.DAYNIGHT/repo", path.win32)).toBe(false);
    expect(pathsOverlap("C:\\Code", "D:\\Code", path.win32)).toBe(false);
  });
});

describe("filesystem case probe lifecycle", () => {
  const directory = path.resolve("probe-parent");
  const probe = path.join(directory, ".daynight-case-unique");
  const identity = { dev: 1n, ino: 2n };
  const operations = () => ({
    mkdtemp: vi.fn(async () => probe),
    lstat: vi.fn(async () => identity),
    rmdir: vi.fn(async () => {}),
  });

  it("detects an insensitive directory and removes its exact empty probe", async () => {
    const filesystem = operations();
    expect(await isFilesystemCaseSensitive(directory, filesystem)).toBe(false);
    expect(filesystem.mkdtemp).toHaveBeenCalledWith(path.join(directory, ".daynight-case-"));
    expect(filesystem.lstat).toHaveBeenCalledWith(path.join(directory, ".DAYNIGHT-CASE-unique"));
    expect(filesystem.rmdir).toHaveBeenCalledExactlyOnceWith(probe);
  });

  it("detects a sensitive directory when the alternate spelling is absent", async () => {
    const filesystem = operations();
    filesystem.lstat.mockResolvedValueOnce(identity).mockRejectedValueOnce(Object.assign(new Error("missing alternate"), { code: "ENOENT" }));
    expect(await isFilesystemCaseSensitive(directory, filesystem)).toBe(true);
    expect(filesystem.rmdir).toHaveBeenCalledExactlyOnceWith(probe);
  });

  it("treats a distinct alternate entry as sensitive rather than trusting its spelling", async () => {
    const filesystem = operations();
    filesystem.lstat.mockResolvedValueOnce(identity).mockResolvedValueOnce({ dev: 1n, ino: 3n });
    expect(await isFilesystemCaseSensitive(directory, filesystem)).toBe(true);
    expect(filesystem.rmdir).toHaveBeenCalledExactlyOnceWith(probe);
  });

  it("preserves an unexpected lookup failure and still removes its empty probe", async () => {
    const filesystem = operations();
    const denied = Object.assign(new Error("lookup denied"), { code: "EACCES" });
    filesystem.lstat.mockRejectedValueOnce(denied);
    await expect(isFilesystemCaseSensitive(directory, filesystem)).rejects.toMatchObject({ cause: denied });
    expect(filesystem.rmdir).toHaveBeenCalledExactlyOnceWith(probe);
  });

  it("exposes cleanup failure after a successful lookup", async () => {
    const filesystem = operations();
    const denied = Object.assign(new Error("cleanup denied"), { code: "EACCES" });
    filesystem.rmdir.mockRejectedValueOnce(denied);
    await expect(isFilesystemCaseSensitive(directory, filesystem)).rejects.toMatchObject({ message: `Cannot remove temporary filesystem case probe ${probe}.`, cause: denied });
  });

  it("retains both lookup and cleanup failures", async () => {
    const filesystem = operations();
    const lookup = new Error("lookup failed");
    const cleanup = new Error("cleanup failed");
    filesystem.lstat.mockRejectedValueOnce(lookup);
    filesystem.rmdir.mockRejectedValueOnce(cleanup);
    try {
      await isFilesystemCaseSensitive(directory, filesystem);
      expect.unreachable("Both errors must be visible.");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toMatchObject([{ cause: lookup }, { cause: cleanup }]);
    }
  });

  it("reports probe creation permissions without attempting unrelated cleanup", async () => {
    const filesystem = operations();
    const denied = Object.assign(new Error("creation denied"), { code: "EACCES" });
    filesystem.mkdtemp.mockRejectedValueOnce(denied);
    await expect(isFilesystemCaseSensitive(directory, filesystem)).rejects.toMatchObject({ cause: denied });
    expect(filesystem.rmdir).not.toHaveBeenCalled();
  });
});
