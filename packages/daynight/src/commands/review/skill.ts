import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { captureSkillBundle, validateSkillEntrypoint } from "../../platform/skill-bundle.js";
import type { BundleEntry } from "../../platform/skill-bundle.js";

const skillName = "daynight-review";
const pluginManifest = Buffer.from(`${JSON.stringify({
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "daynight-review-bundle",
  version: "1.0.0",
})}\n`, "utf8");

export type PreparedReviewSkill = {
  name: typeof skillName;
  digest: string;
  rootDirectory: string;
  directory: string;
  entrypoint: string;
};

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

const bundleDigest = (entries: BundleEntry[]): string => {
  const hash = createHash("sha256").update("daynight-review-plugin-bundle-v1\0");
  const append = (bytes: Buffer): void => {
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(size).update(bytes);
  };
  for (const entry of entries) {
    hash.update(entry.type === "file" ? "f" : "d");
    append(Buffer.from(entry.relativePath, "utf8"));
    if (entry.type === "file") {
      append(entry.contents);
    }
  }
  return hash.digest("hex");
};

const pluginBundle = (entries: BundleEntry[]): BundleEntry[] => [
  { relativePath: "plugin.json", type: "file", contents: pluginManifest },
  { relativePath: "skills", type: "directory" },
  { relativePath: `skills/${skillName}`, type: "directory" },
  ...entries.map((entry): BundleEntry => ({ ...entry, relativePath: `skills/${skillName}/${entry.relativePath}` })),
];

const verifySnapshot = async (directory: string, expected: BundleEntry[]): Promise<void> => {
  const actual = await captureSkillBundle(directory, "Review skill");
  if (actual.length !== expected.length || actual.some((entry, index) => {
    const wanted = expected[index]!;
    return entry.relativePath !== wanted.relativePath || entry.type !== wanted.type ||
      (entry.type === "file" && wanted.type === "file" && !entry.contents.equals(wanted.contents));
  })) {
    throw new Error(`Review skill snapshot does not match its captured bundle: ${directory}.`);
  }
};

export const prepareReviewSkill = async (
  packageDirectory: string,
  cacheDirectory: string,
): Promise<PreparedReviewSkill> => {
  const sourceDirectory = path.join(packageDirectory, "dist", "commands", "review", "skills", skillName);
  let entries: BundleEntry[];
  try {
    entries = await captureSkillBundle(sourceDirectory, "Review skill");
    validateSkillEntrypoint(entries, skillName, "Review skill");
  } catch (cause) {
    throw new Error(`Cannot capture installed review skill bundle ${sourceDirectory}.`, { cause });
  }
  const snapshot = pluginBundle(entries);
  const digest = bundleDigest(snapshot);
  const snapshotsDirectory = path.resolve(cacheDirectory, "review-skills");
  const rootDirectory = path.join(snapshotsDirectory, digest);
  const directory = path.join(rootDirectory, "skills", skillName);
  const prepared: PreparedReviewSkill = { name: skillName, digest, rootDirectory, directory, entrypoint: path.join(directory, "SKILL.md") };
  let temporaryDirectory: string | undefined;
  let preparationError: Error | undefined;
  let publicationError: unknown;
  try {
    await mkdir(snapshotsDirectory, { recursive: true });
    let existing = false;
    try {
      await lstat(rootDirectory);
      existing = true;
    } catch (cause) {
      if (!hasCode(cause, "ENOENT")) {
        throw cause;
      }
    }
    if (!existing) {
      temporaryDirectory = await mkdtemp(path.join(snapshotsDirectory, ".prepare-"));
      for (const entry of snapshot) {
        const destination = path.join(temporaryDirectory, ...entry.relativePath.split("/"));
        if (entry.type === "directory") {
          await mkdir(destination);
        } else {
          await writeFile(destination, entry.contents, { flag: "wx" });
        }
      }
      try {
        await rename(temporaryDirectory, rootDirectory);
        temporaryDirectory = undefined;
      } catch (cause) {
        // A concurrent publication is accepted only after verifying the complete winning snapshot.
        publicationError = cause;
      }
    }
    try {
      await verifySnapshot(rootDirectory, snapshot);
    } catch (cause) {
      if (publicationError !== undefined) {
        throw new AggregateError([publicationError, cause], "Cannot publish or reuse the review skill snapshot.");
      }
      throw cause;
    }
    return prepared;
  } catch (cause) {
    preparationError = new Error(`Cannot prepare review skill snapshot ${rootDirectory}.`, { cause });
    throw preparationError;
  } finally {
    if (temporaryDirectory !== undefined) {
      try {
        await rm(temporaryDirectory, { recursive: true, force: true });
      } catch (cause) {
        const cleanupError = new Error(`Cannot remove review skill preparation directory ${temporaryDirectory}.`, { cause });
        if (preparationError !== undefined) {
          throw new AggregateError([preparationError, cleanupError], "Review skill preparation and cleanup failed.");
        }
        throw cleanupError;
      }
    }
  }
};

export const validateReviewSkillDiscovery = async (
  output: string,
  skill: PreparedReviewSkill,
): Promise<void> => {
  let entries: unknown;
  try {
    entries = JSON.parse(output);
  } catch (cause) {
    throw new Error("Copilot skill discovery did not return valid JSON.", { cause });
  }
  if (!Array.isArray(entries)) {
    throw new Error("Copilot skill discovery must return a JSON array.");
  }
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || !("name" in entry) || typeof entry.name !== "string" || entry.name.trim() === "" || entry.name.includes("\0")) {
      throw new Error("Copilot skill discovery contains a malformed skill entry.");
    }
  }
  const matching = entries.filter((entry: Record<string, unknown>) => entry.name === skill.name);
  if (matching.length !== 1) {
    throw new Error(`Copilot skill discovery must select exactly one ${skill.name} skill; found ${matching.length}.`);
  }
  const match = matching[0] as Record<string, unknown>;
  if (match.enabled !== true) {
    throw new Error(`Copilot skill ${skill.name} must be enabled.`);
  }
  if (typeof match.path !== "string" || match.path.trim() === "" || match.path.includes("\0") || !path.isAbsolute(match.path)) {
    throw new Error(`Copilot skill ${skill.name} must have an absolute directory path.`);
  }
  let actualDirectory: string;
  let expectedDirectory: string;
  try {
    [actualDirectory, expectedDirectory] = await Promise.all([realpath(match.path), realpath(skill.directory)]);
  } catch (cause) {
    throw new Error(`Cannot resolve discovered ${skill.name} skill directory.`, { cause });
  }
  if (actualDirectory !== expectedDirectory) {
    throw new Error(`Copilot skill ${skill.name} resolves to ${actualDirectory}; expected ${expectedDirectory}.`);
  }
};
