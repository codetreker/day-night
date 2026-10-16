import path from "node:path";
import { describe, expect, it } from "vitest";
import { pathsEqual, pathsOverlap, resolveRuntimePaths } from "../src/paths.js";

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

  it("recognizes case and separator variants of Windows paths", () => {
    expect(pathsEqual("C:\\Code\\Repo", "c:/code/repo/", path.win32)).toBe(true);
    expect(pathsOverlap("C:\\Users\\u\\.daynight", "c:/users/u/.DAYNIGHT/repo", path.win32)).toBe(true);
    expect(pathsOverlap("C:\\Code", "D:\\Code", path.win32)).toBe(false);
  });
});
