import path from "node:path";
import { lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

type Token = { readonly kind: "word" | "separator"; readonly text: string };

export const readOwnedCodexArtifact = (filename: string, fixtureDirectory: string): string | undefined => {
  const relative = path.relative(fixtureDirectory, filename);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  try {
    const metadata = lstatSync(filename);
    if (!metadata.isFile() || metadata.size > 16 * 1024) return undefined;
    return readFileSync(filename, "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR")) return undefined;
    throw cause;
  }
};

const shellTokens = (source: string): readonly Token[] | undefined => {
  const tokens: Token[] = [];
  let word = "", started = false;
  let quote: "'" | '"' | undefined;
  const flush = (): void => { if (started) tokens.push({ kind: "word", text: word }); word = ""; started = false; };
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (quote === "'") { if (character === "'") quote = undefined; else word += character; continue; }
    if (character === "$" || character === "`" || character === "#" && quote === undefined) return undefined;
    if (character === "\\") {
      const escaped = source[++index];
      if (escaped === undefined || escaped === "\n") return undefined;
      word += escaped; started = true; continue;
    }
    if (quote === '"') { if (character === '"') quote = undefined; else word += character; continue; }
    if (character === "'" || character === '"') { quote = character; started = true; continue; }
    if (character === "<" || character === ">" || character === "(" || character === ")") return undefined;
    if (character === ";" || character === "\n" || character === "&" || character === "|") {
      flush();
      const doubled = source[index + 1] === character && (character === "&" || character === "|");
      if ((character === "&" || character === "|") && !doubled) return undefined;
      tokens.push({ kind: "separator", text: doubled ? `${character}${source[++index]}` : character });
    } else if (/\s/.test(character)) flush();
    else { word += character; started = true; }
  }
  if (quote !== undefined) return undefined;
  flush();
  return tokens;
};

const exactCodexCatReads = (command: string, workingDirectory: string, filenames: readonly string[]): readonly string[] => {
  let tokens = shellTokens(command);
  if (tokens === undefined) return [];
  const shell = tokens[0];
  if (shell?.kind === "word" && /^(?:\/(?:usr\/)?bin\/)?(?:bash|sh|zsh)$/.test(shell.text)) {
    if (tokens.length !== 3 || tokens[1]?.kind !== "word" || !["-c", "-lc"].includes(tokens[1].text) || tokens[2]?.kind !== "word") return [];
    tokens = shellTokens(tokens[2].text);
    if (tokens === undefined) return [];
  }
  if (tokens.some((token) => token.kind === "word" && ["cd", "pushd", "popd", "eval", "source", "."].includes(token.text))) return [];
  const allowedTargets = new Map<string, string>();
  for (const filename of filenames) {
    allowedTargets.set(filename, filename);
    const relative = path.relative(workingDirectory, filename);
    if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
      allowedTargets.set(relative, filename);
      allowedTargets.set(`.${path.sep}${relative}`, filename);
    }
  }
  const reads = new Set<string>();
  let segment: Token[] = [];
  const observe = (): void => {
    const words = segment.map((token) => token.text);
    if (words[0] === "then") words.shift();
    if (!["cat", "/bin/cat", "/usr/bin/cat"].includes(words[0] ?? "")) return;
    const arguments_ = words.slice(1);
    if (arguments_[0] === "--") arguments_.shift();
    else if (arguments_.some((argument) => argument.startsWith("-"))) return;
    for (const argument of arguments_) {
      const filename = allowedTargets.get(argument);
      if (filename !== undefined) reads.add(filename);
    }
  };
  for (const token of tokens) {
    if (token.kind === "separator") { observe(); segment = []; }
    else segment.push(token);
  }
  observe();
  return [...reads];
};

export type CodexExpectedArtifact = { readonly filename: string; readonly contents: string };
export type CodexReadEvidence = { readonly filename: string; readonly sha256: string };
type CodexReadCommand = {
  readonly command: string;
  readonly cwd: string;
  readonly status: unknown;
  readonly exitCode: unknown;
  readonly aggregatedOutput: unknown;
  readonly commandActions: readonly unknown[];
};

export const codexArtifactReadEvidence = (item: CodexReadCommand, artifacts: readonly CodexExpectedArtifact[]): readonly CodexReadEvidence[] => {
  if (item.status !== "completed" || item.exitCode !== 0 || typeof item.aggregatedOutput !== "string") return [];
  const output = item.aggregatedOutput;
  const expected = new Map(artifacts.map((artifact) => [path.resolve(artifact.filename), artifact.contents]));
  const reads = new Set(exactCodexCatReads(item.command, item.cwd, [...expected.keys()]));
  for (const action of item.commandActions) {
    if (typeof action !== "object" || action === null || Array.isArray(action)) continue;
    const candidate = action as Record<string, unknown>;
    if (candidate.type === "read" && typeof candidate.path === "string") reads.add(path.resolve(item.cwd, candidate.path));
  }
  return [...reads].flatMap((filename) => {
    const contents = expected.get(filename);
    if (contents === undefined || contents === "") return [];
    const start = output.indexOf(contents);
    if (start === -1) return [];
    const matched = output.slice(start, start + contents.length);
    return [{ filename, sha256: createHash("sha256").update(matched).digest("hex") }];
  });
};
