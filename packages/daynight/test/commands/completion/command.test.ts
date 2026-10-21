import { describe, expect, it } from "vitest";
import { commandTree } from "../../../src/cli/commands.js";
import { UsageError } from "../../../src/cli/context.js";
import type { CliContext } from "../../../src/cli/context.js";
import { runCompletionCommand } from "../../../src/commands/completion/command.js";
import { renderBashCompletion } from "../../../src/commands/completion/bash.js";
import { renderZshCompletion } from "../../../src/commands/completion/zsh.js";

const context = (): CliContext & { output: string[]; errors: string[] } => {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    version: "1.2.3",
    packageDirectory: "unused",
    homeDirectory: () => { throw new Error("Completion must not inspect the home directory."); },
    workingDirectory: () => { throw new Error("Completion must not inspect the working directory."); },
    stdout: (text) => { output.push(text); },
    stderr: (text) => { errors.push(text); },
    output,
    errors,
  };
};

describe("completion command", () => {
  it.each([[], ["--help"], ["-h"]])("shows help for %j without reading user state", async (...args) => {
    const dependencies = context();
    await runCompletionCommand(args, dependencies);
    expect(dependencies.output.join("")).toContain("Usage: daynight completion <command>");
    expect(dependencies.output.join("")).toContain("compinit");
    expect(dependencies.errors).toEqual([]);
  });

  it.each(["bash", "zsh", "setup"])("shows %s help without reading user state", async (command) => {
    const dependencies = context();
    await runCompletionCommand([command, "--help"], dependencies);
    expect(dependencies.output.join("")).toContain(`Usage: daynight completion ${command}`);
  });

  it.each([
    ["bash", renderBashCompletion],
    ["zsh", renderZshCompletion],
  ] as const)("emits only the generated %s script", async (shell, render) => {
    const dependencies = context();
    await runCompletionCommand([shell], dependencies);
    expect(dependencies.output).toEqual([render(commandTree)]);
    expect(dependencies.errors).toEqual([]);
  });

  it.each([
    ["fish"], ["Bash"], ["bash", "extra"], ["zsh", "bash"],
    ["--unknown"], ["--help", "bash"],
    ["--version"], ["--"], ["setup", "--activate"], ["setup", "--shell", "fish"],
    ["setup", "--shell"], ["setup", "--rc-file"], ["setup", "--shell=bash", "--shell=zsh"],
  ])("rejects unsupported syntax %j before emitting output", async (...args) => {
    const dependencies = context();
    const error = await runCompletionCommand(args, dependencies).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).helpCommand).toBe("daynight completion --help");
    expect(dependencies.output).toEqual([]);
    expect(dependencies.errors).toEqual([]);
  });
});
