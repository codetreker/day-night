import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";

export type BundleEntry =
  | { relativePath: string; type: "directory" }
  | { relativePath: string; type: "file"; contents: Buffer };

export const captureSkillBundle = async (directory: string, label: string): Promise<BundleEntry[]> => {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error(`${label} bundle must be a directory without symbolic links: ${directory}.`);
  }
  const entries: BundleEntry[] = [];
  const visit = async (relativeDirectory: string): Promise<void> => {
    const names = await readdir(path.join(directory, relativeDirectory));
    for (const name of names) {
      if (name === "" || name === "." || name === ".." || /[/\\\0]/u.test(name)) {
        throw new Error(`${label} bundle contains an invalid path segment: ${JSON.stringify(name)}.`);
      }
      const relativePath = relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
      const filename = path.join(directory, ...relativePath.split("/"));
      const entry = await lstat(filename);
      if (entry.isSymbolicLink()) {
        throw new Error(`${label} bundle must not contain symbolic links: ${filename}.`);
      }
      if (entry.isDirectory()) {
        entries.push({ relativePath, type: "directory" });
        await visit(relativePath);
      } else if (entry.isFile()) {
        entries.push({ relativePath, type: "file", contents: await readFile(filename) });
      } else {
        throw new Error(`${label} bundle must contain only regular files and directories: ${filename}.`);
      }
    }
  };
  await visit("");
  return entries.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
};

export const validateSkillEntrypoint = (entries: readonly BundleEntry[], skillName: string, label: string): void => {
  const entrypoint = entries.find((entry) => entry.relativePath === "SKILL.md");
  if (entrypoint?.type !== "file") {
    throw new Error(`${label} bundle must contain a regular SKILL.md file.`);
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(entrypoint.contents);
  } catch (cause) {
    throw new Error(`${label} SKILL.md must be valid UTF-8.`, { cause });
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  if (frontmatter === null) {
    throw new Error(`${label} SKILL.md must begin with YAML frontmatter.`);
  }
  const document = parseDocument(frontmatter[1]!, {
    strict: true,
    uniqueKeys: true,
    stringKeys: true,
    prettyErrors: false,
  });
  const problems = [...document.errors, ...document.warnings];
  if (problems.length !== 0) {
    throw new Error(`${label} SKILL.md has invalid YAML frontmatter.`, {
      cause: new AggregateError(problems, `${label} frontmatter was rejected.`),
    });
  }
  let metadata: unknown;
  try {
    metadata = document.toJS();
  } catch (cause) {
    throw new Error(`Cannot decode ${label.toLowerCase()} frontmatter.`, { cause });
  }
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error(`${label} frontmatter must be a mapping.`);
  }
  if (!("name" in metadata) || metadata.name !== skillName) {
    throw new Error(`${label} frontmatter name must be ${skillName}.`);
  }
  if (!("description" in metadata) || typeof metadata.description !== "string" || metadata.description.trim() === "" || metadata.description.includes("\0")) {
    throw new Error(`${label} frontmatter description must be a nonempty string without NUL characters.`);
  }
};
