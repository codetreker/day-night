import { randomUUID } from "node:crypto";

export type GitSnapshotEntry = { path: string; mode: "100644" | "100755" | "120000"; contents: string }
  | { path: string; mode: "040000" | "160000"; object: string };
type GitExecutor = (args: string[], input?: string) => string;

const quotePath = (filename: string): string => `"${[...Buffer.from(filename)].map((byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("")}"`;
const data = (contents: string): string => `data ${Buffer.byteLength(contents)}\n${contents}\n`;

export const writeGitSnapshot = (git: GitExecutor, entries: readonly GitSnapshotEntry[], message: string, parents: readonly string[] = []): string => {
  // The mark returns the object ID while resetting the private branch in the same import stream leaves no fixture ref.
  // https://github.com/git/git/blob/a018953688f1b10bddf91bff8747068f5f4746a4/Documentation/git-fast-import.adoc#L1128-L1140
  // https://github.com/git/git/blob/a018953688f1b10bddf91bff8747068f5f4746a4/Documentation/git-fast-import.adoc#L637-L638
  const reference = `refs/fixture-snapshots/${randomUUID()}`;
  const identity = "Fixture <fixture@example.invalid> 1700000000 +0000";
  const input = `commit ${reference}\nmark :1\nauthor ${identity}\ncommitter ${identity}\n${data(message)}`
    + parents.map((parent, index) => `${index === 0 ? "from" : "merge"} ${parent}\n`).join("")
    + "deleteall\n"
    + entries.map((entry) => `M ${entry.mode} ${"object" in entry ? entry.object : "inline"} ${quotePath(entry.path)}\n${"contents" in entry ? data(entry.contents) : ""}`).join("")
    + `\nget-mark :1\nreset ${reference}\nfrom ${"0".repeat(40)}\n\ndone\n`;
  // Keep small imports packed: the default unpack limit otherwise starts an extra unpack-objects process.
  // https://github.com/git/git/blob/a018953688f1b10bddf91bff8747068f5f4746a4/builtin/fast-import.c#L871-L915
  return git(["-c", "fastimport.unpackLimit=0", "fast-import", "--quiet", "--done"], input);
};
