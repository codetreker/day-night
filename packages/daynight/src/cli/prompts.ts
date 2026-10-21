import { createInterface } from "node:readline";
import type { Interface } from "node:readline";

export class SetupCancelledError extends Error {
  constructor(options?: ErrorOptions) {
    super("Setup cancelled.", options);
    this.name = "SetupCancelledError";
  }
}

export type CliPrompt = {
  readonly isInteractive: boolean;
  ask(question: string, signal: AbortSignal): Promise<string>;
  close(): void;
};

export const createTerminalPrompt = (): CliPrompt => {
  let terminal: Interface | undefined;
  let closed = false;
  const lines: string[] = [];
  let waiting: { resolve: (line: string) => void; reject: (cause: unknown) => void } | undefined;
  const cancel = (): void => {
    closed = true;
    waiting?.reject(new SetupCancelledError());
    waiting = undefined;
  };
  return {
    isInteractive: process.stdin.isTTY === true && process.stderr.isTTY === true,
    ask: async (question, signal) => {
      signal.throwIfAborted();
      if (closed) throw new SetupCancelledError();
      if (terminal === undefined) {
        terminal = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
        terminal.on("line", (line) => {
          if (waiting === undefined) lines.push(line);
          else { const pending = waiting; waiting = undefined; pending.resolve(line); }
        });
        terminal.on("close", cancel);
        terminal.on("SIGINT", cancel);
      }
      process.stderr.write(question);
      if (lines.length !== 0) return lines.shift()!;
      return new Promise<string>((resolve, reject) => {
        const abort = (): void => { waiting = undefined; reject(new SetupCancelledError({ cause: signal.reason })); };
        waiting = {
          resolve: (line) => { signal.removeEventListener("abort", abort); resolve(line); },
          reject: (cause) => { signal.removeEventListener("abort", abort); reject(cause); },
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    },
    close: () => { closed = true; terminal?.close(); },
  };
};
