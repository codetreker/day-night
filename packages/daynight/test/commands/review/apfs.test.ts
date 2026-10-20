import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfiguration } from "../../../src/commands/review/config.js";
import { resolveReviewPaths } from "../../../src/commands/review/paths.js";
import { cleanupApfsFixture } from "../../fixtures/apfs-cleanup.js";

const execute = promisify(execFile);
const modes = [
  { format: "APFS", caseSensitive: false },
  { format: "Case-sensitive APFS", caseSensitive: true },
] as const;

describe.skipIf(process.platform !== "darwin").each(modes)(
  "$format configuration paths",
  ({ format, caseSensitive }) => {
    let directory: string | undefined;
    let mountDirectory: string;
    let homeDirectory: string;
    let attachmentAttempted = false;

    beforeAll(async () => {
      const temporaryDirectory = fileURLToPath(new URL("../../../../../.tmp/", import.meta.url));
      await mkdir(temporaryDirectory, { recursive: true });
      directory = await mkdtemp(path.join(temporaryDirectory, "apfs-config-"));
      mountDirectory = path.join(directory, "mounted volume");
      await mkdir(mountDirectory);
      const image = path.join(directory, "filesystem.sparseimage");
      await execute("/usr/bin/hdiutil", [
        "create", "-size", "256m", "-type", "SPARSE", "-fs", format,
        "-volname", caseSensitive ? "DaynightSensitive" : "DaynightInsensitive", "-quiet", image,
      ], { timeout: 60_000 });
      attachmentAttempted = true;
      await execute("/usr/bin/hdiutil", [
        "attach", "-nobrowse", "-noautoopen", "-mountpoint", mountDirectory, image,
      ], { timeout: 30_000 });
      homeDirectory = path.join(mountDirectory, "Review Home 用户");
      await mkdir(resolveReviewPaths(homeDirectory).stateDirectory, { recursive: true });
      const probe = path.join(homeDirectory, "CaseProbe");
      await mkdir(probe);
      if (caseSensitive) {
        await expect(stat(path.join(homeDirectory, "caseprobe"))).rejects.toMatchObject({ code: "ENOENT" });
      } else {
        expect((await stat(path.join(homeDirectory, "caseprobe"))).ino).toBe((await stat(probe)).ino);
      }
    }, 120_000);

    afterAll(async () => {
      await cleanupApfsFixture({ directory, mountDirectory, attachmentAttempted });
    }, 40_000);

    it.each([
      ["../Repo", "../repo"],
      ["../New/Repo", "../new/repo"],
    ])("uses volume lookup rules for missing destinations %s and %s", async (first, second) => {
      const paths = resolveReviewPaths(homeDirectory);
      await writeFile(paths.configFile, JSON.stringify({
        repositories: [
          { remote: "https://github.com/owner/first", path: first },
          { remote: "https://github.com/owner/second", path: second },
        ],
      }));
      const originalEntries = await readdir(homeDirectory);
      if (caseSensitive) {
        expect((await loadConfiguration(paths)).repositories).toHaveLength(2);
      } else {
        await expect(loadConfiguration(paths)).rejects.toThrow("same location");
      }
      expect(await readdir(homeDirectory)).toEqual(originalEntries);
    });

    it("uses volume lookup rules for state-directory aliases", async () => {
      const paths = resolveReviewPaths(homeDirectory);
      await writeFile(paths.configFile, JSON.stringify({
        repositories: [{ remote: "https://github.com/owner/repo", path: "../.DAYNIGHT/repo" }],
      }));
      if (caseSensitive) {
        expect((await loadConfiguration(paths)).repositories).toHaveLength(1);
      } else {
        await expect(loadConfiguration(paths)).rejects.toThrow("must not overlap");
      }
    });

    it("rejects missing Unicode spelling aliases using actual APFS lookup", async () => {
      const paths = resolveReviewPaths(homeDirectory);
      const reference = path.join(homeDirectory, "caf\u00e9-reference");
      await mkdir(reference);
      expect((await stat(path.join(homeDirectory, "cafe\u0301-reference"))).ino).toBe((await stat(reference)).ino);
      await writeFile(paths.configFile, JSON.stringify({
        repositories: [
          { remote: "https://github.com/owner/first", path: "../New/caf\u00e9" },
          { remote: "https://github.com/owner/second", path: "../New/cafe\u0301" },
        ],
      }));
      const originalEntries = await readdir(homeDirectory);
      await expect(loadConfiguration(paths)).rejects.toThrow("same location");
      expect(await readdir(homeDirectory)).toEqual(originalEntries);
    });
  },
);
