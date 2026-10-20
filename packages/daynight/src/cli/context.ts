import { homedir } from "node:os";

export type CliContext = {
  version: string;
  packageDirectory: string;
  homeDirectory: () => string;
  workingDirectory: () => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export type CliCommand = {
  run: (args: readonly string[], context: CliContext) => Promise<void>;
};

export class UsageError extends Error {
  constructor(message: string, readonly helpCommand = "daynight --help") {
    super(message);
    this.name = "UsageError";
  }
}

export const isHelp = (argument: string | undefined): boolean => argument === "--help" || argument === "-h";

export const createCliContext = (version: string, packageDirectory: string): CliContext => ({
  version,
  packageDirectory,
  homeDirectory: homedir,
  workingDirectory: process.cwd,
  stdout: (text) => { process.stdout.write(text); },
  stderr: (text) => { process.stderr.write(text); },
});
