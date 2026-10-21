import path from "node:path";
import { lstatSync, readFileSync } from "node:fs";

type Token = { readonly kind: "word" | "separator"; readonly text: string };

export const readOwnedCodexConfig = (filename: string, fixtureDirectory: string): string | undefined => {
  const relative = path.relative(fixtureDirectory, filename);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !filename.endsWith(`${path.sep}.git${path.sep}config`)) return undefined;
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

export const exactCodexConfigCat = (command: string, workingDirectory: string): string | undefined => {
  let tokens = shellTokens(command);
  if (tokens === undefined) return undefined;
  const shell = tokens[0];
  if (shell?.kind === "word" && /^(?:\/(?:usr\/)?bin\/)?(?:bash|sh|zsh)$/.test(shell.text)) {
    if (tokens.length !== 3 || tokens[1]?.kind !== "word" || !["-c", "-lc"].includes(tokens[1].text) || tokens[2]?.kind !== "word") return undefined;
    tokens = shellTokens(tokens[2].text);
    if (tokens === undefined) return undefined;
  }
  if (tokens.some((token) => token.kind === "word" && ["cd", "pushd", "popd", "eval", "source", "."].includes(token.text))) return undefined;
  const expected = path.join(workingDirectory, ".git/config");
  const allowedTargets = new Set([".git/config", "./.git/config", expected]);
  let segment: Token[] = [];
  const matches = (): boolean => {
    const words = segment.map((token) => token.text);
    if (words[0] === "then") words.shift();
    if (!["cat", "/bin/cat", "/usr/bin/cat"].includes(words[0] ?? "")) return false;
    const arguments_ = words.slice(1);
    if (arguments_[0] === "--") arguments_.shift();
    return arguments_.length === 1 && allowedTargets.has(arguments_[0]!);
  };
  for (const token of tokens) {
    if (token.kind === "separator") { if (matches()) return expected; segment = []; }
    else segment.push(token);
  }
  return matches() ? expected : undefined;
};
