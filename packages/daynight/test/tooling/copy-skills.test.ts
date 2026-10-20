import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../../.tmp/copy-skill-tests");
const script = path.resolve(import.meta.dirname, "../../scripts/copy-skills.ts");
const directories: string[] = [];
const fixture = () => {
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(path.join(root, "package, 中文 "));
  directories.push(directory);
  const source = path.join(directory, "src/commands/review/skills/daynight-review");
  const destination = path.join(directory, "dist/commands/review/skills/daynight-review");
  const scripts = path.join(directory, "scripts");
  const caller = path.join(directory, "unrelated caller");
  mkdirSync(scripts);
  mkdirSync(caller);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
  cpSync(script, path.join(scripts, "copy-skills.ts"));
  const run = () => {
    const result = spawnSync(process.execPath, [path.join(scripts, "copy-skills.ts")], {
      cwd: caller, encoding: "utf8", windowsHide: true, timeout: 10_000,
    });
    if (result.error !== undefined) throw result.error;
    return result;
  };
  return { source, destination, run };
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("packaged skill resource copy", () => {
  it("copies a complete bundle into an absent destination and refuses to replace it", () => {
    const f = fixture();
    mkdirSync(path.join(f.source, "references"), { recursive: true });
    writeFileSync(path.join(f.source, "SKILL.md"), "original skill\n");
    const resource = Buffer.from([0, 1, 127, 255]);
    writeFileSync(path.join(f.source, "references/data.bin"), resource);
    const compiled = path.join(path.dirname(f.destination), "compiled.js");
    writeFileSync(compiled, "compiled module\n");
    expect(existsSync(f.destination)).toBe(false);
    const copied = f.run();
    expect(copied.status, copied.stderr).toBe(0);
    expect(readFileSync(path.join(f.destination, "SKILL.md"), "utf8")).toBe("original skill\n");
    expect(readFileSync(path.join(f.destination, "references/data.bin"))).toEqual(resource);
    expect(readFileSync(compiled, "utf8")).toBe("compiled module\n");
    writeFileSync(path.join(f.source, "SKILL.md"), "replacement skill\n");
    const repeated = f.run();
    expect(repeated.status).not.toBe(0);
    expect(repeated.stderr).toContain("ERR_FS_CP_EEXIST");
    expect(readFileSync(path.join(f.destination, "SKILL.md"), "utf8")).toBe("original skill\n");
    expect(readFileSync(path.join(f.destination, "references/data.bin"))).toEqual(resource);
  });

  it("exposes a missing source bundle without creating a destination", () => {
    const f = fixture();
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ENOENT");
    expect(existsSync(f.destination)).toBe(false);
  });
});
