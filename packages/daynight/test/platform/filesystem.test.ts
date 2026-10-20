import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { missingPathsReferToSameDirectory, pathsEqual, pathsOverlap } from "../../src/platform/filesystem.js";

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

describe("filesystem destination probe lifecycle", () => {
  const directory = path.resolve("probe-parent");
  const probe = path.join(directory, ".daynight-path-unique");
  const first = ["New", "café"];
  const second = ["new", "cafe\u0301"];
  const parent = path.join(probe, "New");
  const leaf = path.join(parent, "café");
  const identity = { dev: 1n, ino: 2n };
  const operations = () => ({
    mkdtemp: vi.fn(async () => probe),
    mkdir: vi.fn(async () => {}),
    lstat: vi.fn(async () => identity),
    rmdir: vi.fn(async () => {}),
  });

  it("observes exact candidate spellings and removes only its created directories deepest first", async () => {
    const filesystem = operations();
    expect(await missingPathsReferToSameDirectory(directory, first, second, filesystem)).toBe(true);
    expect(filesystem.mkdtemp).toHaveBeenCalledWith(path.join(directory, ".daynight-path-"));
    expect(filesystem.mkdir.mock.calls).toEqual([[parent], [leaf]]);
    expect(filesystem.lstat.mock.calls).toEqual([[leaf], [path.join(probe, ...second)]]);
    expect(filesystem.rmdir.mock.calls).toEqual([[leaf], [parent], [probe]]);
  });

  it("accepts distinct destinations when the alternate spelling does not exist", async () => {
    const filesystem = operations();
    filesystem.lstat.mockResolvedValueOnce(identity).mockRejectedValueOnce(Object.assign(new Error("missing alternate"), { code: "ENOENT" }));
    expect(await missingPathsReferToSameDirectory(directory, first, second, filesystem)).toBe(false);
    expect(filesystem.rmdir.mock.calls).toEqual([[leaf], [parent], [probe]]);
  });

  it("uses physical identity rather than assuming an existing alternate spelling is an alias", async () => {
    const filesystem = operations();
    filesystem.lstat.mockResolvedValueOnce(identity).mockResolvedValueOnce({ dev: 1n, ino: 3n });
    expect(await missingPathsReferToSameDirectory(directory, first, second, filesystem)).toBe(false);
  });

  it("cleans up only successfully created directories after a partial mkdir failure", async () => {
    const filesystem = operations();
    const denied = Object.assign(new Error("mkdir denied"), { code: "EACCES" });
    filesystem.mkdir.mockResolvedValueOnce(undefined).mockRejectedValueOnce(denied);
    await expect(missingPathsReferToSameDirectory(directory, first, second, filesystem)).rejects.toMatchObject({ cause: denied });
    expect(filesystem.rmdir.mock.calls).toEqual([[parent], [probe]]);
    expect(filesystem.lstat).not.toHaveBeenCalled();
  });

  it("preserves unexpected lookup failure and still removes all of its created directories", async () => {
    const filesystem = operations();
    const denied = Object.assign(new Error("lookup denied"), { code: "EACCES" });
    filesystem.lstat.mockRejectedValueOnce(denied);
    await expect(missingPathsReferToSameDirectory(directory, first, second, filesystem)).rejects.toMatchObject({ cause: denied });
    expect(filesystem.rmdir.mock.calls).toEqual([[leaf], [parent], [probe]]);
  });

  it("reports cleanup failure and continues attempting remaining nonrecursive removals", async () => {
    const filesystem = operations();
    const denied = Object.assign(new Error("cleanup denied"), { code: "EACCES" });
    filesystem.rmdir.mockRejectedValueOnce(denied);
    await expect(missingPathsReferToSameDirectory(directory, first, second, filesystem)).rejects.toMatchObject({ message: `Cannot remove temporary filesystem path probe directory ${leaf}.`, cause: denied });
    expect(filesystem.rmdir.mock.calls).toEqual([[leaf], [parent], [probe]]);
  });

  it("retains the primary failure together with every cleanup failure", async () => {
    const filesystem = operations();
    const lookup = new Error("lookup failed");
    const cleanup = [new Error("leaf cleanup failed"), new Error("parent cleanup failed"), new Error("sandbox cleanup failed")];
    filesystem.lstat.mockRejectedValueOnce(lookup);
    for (const error of cleanup) {
      filesystem.rmdir.mockRejectedValueOnce(error);
    }
    try {
      await missingPathsReferToSameDirectory(directory, first, second, filesystem);
      expect.unreachable("Every failure must be visible.");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toMatchObject([{ cause: lookup }, ...cleanup.map((cause) => ({ cause }))]);
    }
    expect(filesystem.rmdir.mock.calls).toEqual([[leaf], [parent], [probe]]);
  });

  it("reports sandbox creation permissions without attempting unrelated cleanup", async () => {
    const filesystem = operations();
    const denied = Object.assign(new Error("creation denied"), { code: "EACCES" });
    filesystem.mkdtemp.mockRejectedValueOnce(denied);
    await expect(missingPathsReferToSameDirectory(directory, first, second, filesystem)).rejects.toMatchObject({ cause: denied });
    expect(filesystem.rmdir).not.toHaveBeenCalled();
  });
});
