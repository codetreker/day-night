import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";

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

type BundleEntry =
  | { relativePath: string; type: "directory" }
  | { relativePath: string; type: "file"; contents: Buffer };

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

const captureBundle = async (directory: string): Promise<BundleEntry[]> => {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error(`Review skill bundle must be a directory without symbolic links: ${directory}.`);
  }
  const entries: BundleEntry[] = [];
  const visit = async (relativeDirectory: string): Promise<void> => {
    const names = await readdir(path.join(directory, relativeDirectory));
    for (const name of names) {
      if (name === "" || name === "." || name === ".." || /[/\\\0]/u.test(name)) {
        throw new Error(`Review skill bundle contains an invalid path segment: ${JSON.stringify(name)}.`);
      }
      const relativePath = relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
      const filename = path.join(directory, ...relativePath.split("/"));
      const entry = await lstat(filename);
      if (entry.isSymbolicLink()) {
        throw new Error(`Review skill bundle must not contain symbolic links: ${filename}.`);
      }
      if (entry.isDirectory()) {
        entries.push({ relativePath, type: "directory" });
        await visit(relativePath);
      } else if (entry.isFile()) {
        entries.push({ relativePath, type: "file", contents: await readFile(filename) });
      } else {
        throw new Error(`Review skill bundle must contain only regular files and directories: ${filename}.`);
      }
    }
  };
  await visit("");
  return entries.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
};

const validateEntrypoint = (entries: BundleEntry[]): void => {
  const entrypoint = entries.find((entry) => entry.relativePath === "SKILL.md");
  if (entrypoint?.type !== "file") {
    throw new Error("Review skill bundle must contain a regular SKILL.md file.");
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(entrypoint.contents);
  } catch (cause) {
    throw new Error("Review skill SKILL.md must be valid UTF-8.", { cause });
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  if (frontmatter === null) {
    throw new Error("Review skill SKILL.md must begin with YAML frontmatter.");
  }
  const document = parseDocument(frontmatter[1]!, {
    strict: true,
    uniqueKeys: true,
    stringKeys: true,
    prettyErrors: false,
  });
  const problems = [...document.errors, ...document.warnings];
  if (problems.length !== 0) {
    throw new Error("Review skill SKILL.md has invalid YAML frontmatter.", {
      cause: new AggregateError(problems, "Review skill frontmatter was rejected."),
    });
  }
  let metadata: unknown;
  try {
    metadata = document.toJS();
  } catch (cause) {
    throw new Error("Cannot decode review skill frontmatter.", { cause });
  }
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error("Review skill frontmatter must be a mapping.");
  }
  if (!("name" in metadata) || metadata.name !== skillName) {
    throw new Error(`Review skill frontmatter name must be ${skillName}.`);
  }
  if (!("description" in metadata) || typeof metadata.description !== "string" || metadata.description.trim() === "" || metadata.description.includes("\0")) {
    throw new Error("Review skill frontmatter description must be a nonempty string without NUL characters.");
  }
};

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
  const actual = await captureBundle(directory);
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
    entries = await captureBundle(sourceDirectory);
    validateEntrypoint(entries);
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
