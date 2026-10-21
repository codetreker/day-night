import * as filesystem from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageError } from "../../../src/cli/context.js";
import { setupCompletion, renderSetupBlock } from "../../../src/commands/completion/setup.js";
import type { CompletionShell, SetupDependencies } from "../../../src/commands/completion/setup.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof filesystem>();
  return { ...actual, access: vi.fn(actual.access), open: vi.fn(actual.open), lstat: vi.fn(actual.lstat) };
});
const actualFilesystem = await vi.importActual<typeof filesystem>("node:fs/promises");
const roots: string[] = [];
const fixture = async () => {
  const temporary = fileURLToPath(new URL("../../../../../.tmp/", import.meta.url));
  await filesystem.mkdir(temporary, { recursive: true });
  const root = await filesystem.mkdtemp(path.join(temporary, "completion-setup-"));
  roots.push(root);
  const home = path.join(root, "home 中文");
  const cwd = path.join(root, "caller");
  await filesystem.mkdir(home); await filesystem.mkdir(cwd);
  const context = { homeDirectory: () => home, workingDirectory: () => cwd };
  const dependencies: SetupDependencies = { environment: {}, callingShell: async () => "bash" };
  const setup = (shell: CompletionShell | undefined = "bash", rcFile?: string) => setupCompletion({ shell, rcFile }, context, dependencies);
  return { root, home, cwd, context, dependencies, setup };
};

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(filesystem.access).mockImplementation(actualFilesystem.access);
  vi.mocked(filesystem.open).mockImplementation(actualFilesystem.open);
  vi.mocked(filesystem.lstat).mockImplementation(actualFilesystem.lstat);
  await Promise.all(roots.splice(0).map((root) => filesystem.rm(root, { recursive: true, force: true })));
});

describe("completion setup", () => {
  it("installs both Bash entry points and is byte-identical on repeat", async () => {
    const { home, setup } = await fixture();
    const first = await setup();
    expect(first.files).toEqual([".bashrc", ".bash_profile"].map((name) => ({ path: path.join(home, name), installed: true })));
    const before = await Promise.all(first.files.map((file) => filesystem.readFile(file.path)));
    expect((await setup()).files.every((file) => !file.installed)).toBe(true);
    expect(await Promise.all(first.files.map((file) => filesystem.readFile(file.path)))).toEqual(before);
    expect((await filesystem.readdir(home)).sort()).toEqual([".bash_profile", ".bashrc"]);
  });

  it.each([".bash_profile", ".bash_login", ".profile"])("uses an existing %s without introducing a higher-priority login profile", async (name) => {
    const { home, setup } = await fixture();
    const file = path.join(home, name);
    await filesystem.writeFile(file, "# existing\n");
    const result = await setup();
    expect(result.files[1]!.path).toBe(file);
    expect((await filesystem.readFile(file, "utf8")).startsWith("# existing\n")).toBe(true);
    expect((await filesystem.readdir(home)).sort()).toEqual([name, ".bashrc"].sort());
  });

  it("uses only the first readable login profile", async () => {
    const { home, setup } = await fixture();
    for (const name of [".bash_profile", ".bash_login", ".profile"]) await filesystem.writeFile(path.join(home, name), "original\n");
    const access = actualFilesystem.access;
    vi.mocked(filesystem.access).mockImplementation(async (file, mode) => {
      if (file === path.join(home, ".bash_profile") && mode === constants.R_OK) throw Object.assign(new Error("unreadable"), { code: "EACCES" });
      return access(file, mode);
    });
    expect((await setup()).files[1]!.path).toBe(path.join(home, ".bash_login"));
    expect(await filesystem.readFile(path.join(home, ".bash_profile"), "utf8")).toBe("original\n");
    expect(await filesystem.readFile(path.join(home, ".profile"), "utf8")).toBe("original\n");
  });

  it("fails without hiding existing unreadable profiles", async () => {
    const { home, setup } = await fixture();
    await filesystem.writeFile(path.join(home, ".profile"), "original\n");
    const error = Object.assign(new Error("unreadable"), { code: "EACCES" });
    vi.mocked(filesystem.access).mockRejectedValue(error);
    await expect(setup()).rejects.toMatchObject({ cause: error });
    expect(await filesystem.readdir(home)).toEqual([".profile"]);
  });

  it("preserves original bytes, permissions and symlink identity while emitting LF shell syntax", async () => {
    const { home, cwd, setup } = await fixture();
    const target = path.join(cwd, "actual rc");
    const file = path.join(home, ".bashrc");
    const original = Buffer.from([0x23, 0xff, 0x0d, 0x0a, 0x23]);
    await filesystem.writeFile(target, original, { mode: 0o640 });
    await filesystem.symlink(target, file, "file");
    const before = await filesystem.stat(target);
    await setup();
    expect(await filesystem.readlink(file)).toBe(target);
    const after = await filesystem.stat(target);
    expect(after.ino).toBe(before.ino);
    expect(after.mode).toBe(before.mode);
    expect(await filesystem.readFile(target)).toEqual(Buffer.concat([original, Buffer.from(`\n${renderSetupBlock("bash")}`)]));
  });

  it.each(["directory", "dangling"])("rejects a %s startup target", async (kind) => {
    const { home, setup } = await fixture();
    const file = path.join(home, ".bashrc");
    if (kind === "directory") await filesystem.mkdir(file);
    else await filesystem.symlink(path.join(home, "missing"), file, "file");
    await expect(setup()).rejects.toThrow();
    expect(await filesystem.readdir(home)).toEqual([".bashrc"]);
  });

  it("recognizes canonical manual loading without rewriting it", async () => {
    const { home, setup } = await fixture();
    const file = path.join(home, ".bashrc");
    const original = "# manual\n  source <(daynight completion bash)\n";
    await filesystem.writeFile(file, original);
    expect((await setup()).files[0]!.installed).toBe(false);
    expect(await filesystem.readFile(file, "utf8")).toBe(original);
  });

  it.each([
    "# >>> daynight completion >>>\n",
    "# <<< daynight completion <<<\n",
    `${renderSetupBlock("bash")}${renderSetupBlock("bash")}`,
    renderSetupBlock("bash").replace("complete -p", "changed -p"),
  ])("rejects damaged or duplicated blocks without changing the file", async (original) => {
    const { home, setup } = await fixture();
    const file = path.join(home, ".bashrc");
    await filesystem.writeFile(file, original);
    await expect(setup()).rejects.toThrow(/block/);
    expect(await filesystem.readFile(file, "utf8")).toBe(original);
    expect(await filesystem.readdir(home)).toEqual([".bashrc"]);
  });

  it("manages only an explicit rc file without inspecting home", async () => {
    const { cwd, dependencies } = await fixture();
    const result = await setupCompletion({ shell: "bash", rcFile: "custom/rc" }, {
      homeDirectory: () => { throw new Error("Home must remain unread."); }, workingDirectory: () => cwd,
    }, dependencies);
    expect(result.files).toEqual([{ path: path.join(cwd, "custom/rc"), installed: true }]);
  });

  it.each([undefined, "relative-zdot"])("distinguishes unset and %j ZDOTDIR", async (zdotdir) => {
    const { home, cwd, context, dependencies } = await fixture();
    if (zdotdir !== undefined) dependencies.environment.ZDOTDIR = zdotdir;
    const result = await setupCompletion({ shell: "zsh", rcFile: undefined }, context, dependencies);
    expect(result.files[0]!.path).toBe(path.join(zdotdir === undefined ? home : path.resolve(cwd, zdotdir), ".zshrc"));
  });

  it("maps an explicitly empty ZDOTDIR to the filesystem root without accessing it", async () => {
    const { cwd, dependencies } = await fixture();
    const rootRc = path.resolve(cwd, "/.zshrc");
    const failure = Object.assign(new Error("synthetic denied root access"), { code: "EACCES" });
    dependencies.environment.ZDOTDIR = "";
    const lstat = vi.mocked(filesystem.lstat).mockImplementation(async (file, options) => {
      if (file === rootRc) throw failure;
      return actualFilesystem.lstat(file, options);
    });
    await expect(setupCompletion({ shell: "zsh", rcFile: undefined }, {
      homeDirectory: () => { throw new Error("Explicit ZDOTDIR must not inspect home."); },
      workingDirectory: () => cwd,
    }, dependencies)).rejects.toBe(failure);
    expect(lstat).toHaveBeenCalledWith(rootRc);
  });

  it("uses explicit shell without inspecting calling process or SHELL", async () => {
    const { context, dependencies } = await fixture();
    dependencies.environment.SHELL = "/bin/fish";
    dependencies.callingShell = vi.fn(async () => { throw new Error("Must not detect."); });
    expect((await setupCompletion({ shell: "zsh", rcFile: undefined }, context, dependencies)).shell).toBe("zsh");
    expect(dependencies.callingShell).not.toHaveBeenCalled();
  });

  it("infers calling shell and refuses uncertainty without using SHELL", async () => {
    const { context, dependencies, home } = await fixture();
    dependencies.callingShell = async () => undefined;
    dependencies.environment.SHELL = "/bin/bash";
    await expect(setupCompletion({ shell: undefined, rcFile: undefined }, context, dependencies)).rejects.toBeInstanceOf(UsageError);
    expect(await filesystem.readdir(home)).toEqual([]);
    dependencies.callingShell = async () => "zsh";
    expect((await setupCompletion({ shell: undefined, rcFile: undefined }, context, dependencies)).shell).toBe("zsh");
  });

  it("retains a shell detection failure cause", async () => {
    const { context, dependencies } = await fixture();
    const failure = new Error("ps unavailable");
    dependencies.callingShell = async () => { throw failure; };
    await expect(setupCompletion({ shell: undefined, rcFile: undefined }, context, dependencies)).rejects.toMatchObject({ cause: failure });
  });

  it("serializes concurrent setup without duplicate blocks", async () => {
    const { setup, home } = await fixture();
    const results = await Promise.all([setup(), setup(), setup()]);
    expect(results.flatMap((result) => result.files).filter((file) => file.installed)).toHaveLength(2);
    expect(await filesystem.readFile(path.join(home, ".bashrc"), "utf8")).toBe(renderSetupBlock("bash"));
  });

  it("detects concurrent unrelated edits without overwriting them", async () => {
    const { setup, home } = await fixture();
    const file = path.join(home, ".bashrc");
    await filesystem.writeFile(file, "# original\n");
    const open = actualFilesystem.open;
    vi.mocked(filesystem.open).mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === file) {
        const read = handle.readFile.bind(handle);
        vi.spyOn(handle, "readFile").mockImplementation(async () => {
          const content = await read();
          await filesystem.appendFile(file, "# concurrent edit\n");
          return content;
        });
      }
      return handle;
    });
    await expect(setup()).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringContaining("changed during setup") }) });
    expect(await filesystem.readFile(file, "utf8")).toBe("# original\n# concurrent edit\n");
    expect(await filesystem.readdir(home)).toEqual([".bashrc"]);
  });

  it("preserves write failures and cleans up its lock", async () => {
    const { setup, home } = await fixture();
    const failure = new Error("disk write failed");
    const open = actualFilesystem.open;
    vi.mocked(filesystem.open).mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === path.join(home, ".bashrc")) vi.spyOn(handle, "writeFile").mockRejectedValue(failure);
      return handle;
    });
    await expect(setup()).rejects.toMatchObject({ cause: failure });
    expect(await filesystem.readdir(home)).toEqual([".bashrc"]);
  });

  it.skipIf(process.platform === "win32")("emits a Bash block that shared POSIX profiles can parse", () => {
    const result = spawnSync("sh", ["-n"], { input: renderSetupBlock("bash"), encoding: "utf8", timeout: 3_000 });
    expect(result.status, result.stderr).toBe(0);
  });
});
