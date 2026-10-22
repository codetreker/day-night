import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readSecretStdin } from "../../src/cli/input.js";

const released = (input: PassThrough, signal: AbortSignal): void => {
  for (const event of ["data", "end", "error"]) expect(input.listenerCount(event)).toBe(0);
  expect(input.isPaused()).toBe(true);
  expect(signal.aborted).toBe(false);
};

describe("secret stdin transport", () => {
  it("collects piped bytes until EOF and releases its stream listeners", async () => {
    const input = new PassThrough();
    const signal = new AbortController().signal;
    const pending = readSecretStdin(signal, input);
    input.write("secret-");
    input.end("value\r\n");
    expect(await pending).toBe("secret-value\r\n");
    released(input, signal);
  });

  it("does not block on an input whose EOF was already observed", async () => {
    const input = new PassThrough();
    input.resume();
    const ended = new Promise<void>((resolve) => input.once("end", resolve));
    input.end();
    await ended;
    const signal = new AbortController().signal;
    expect(await readSecretStdin(signal, input)).toBe("");
    released(input, signal);
  });

  it("rejects a terminal before listening or consuming any bytes", async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    await expect(readSecretStdin(new AbortController().signal, input)).rejects.toThrow("piped input");
    expect(input.listenerCount("data")).toBe(0);
  });

  it("cancels a pending pipe read and leaves no input listeners", async () => {
    const input = new PassThrough();
    const cancellation = new AbortController();
    const pending = readSecretStdin(cancellation.signal, input);
    input.write("secret-that-must-not-enter-errors");
    cancellation.abort();
    await expect(pending).rejects.toThrow("Setup cancelled.");
    for (const event of ["data", "end", "error"]) expect(input.listenerCount(event)).toBe(0);
    expect(input.isPaused()).toBe(true);
  });

  it("propagates the original read error and releases listeners", async () => {
    const input = new PassThrough();
    const signal = new AbortController().signal;
    const pending = readSecretStdin(signal, input);
    const error = new Error("pipe failed");
    input.emit("error", error);
    await expect(pending).rejects.toBe(error);
    released(input, signal);
  });

  it("bounds input memory without putting token bytes in the diagnostic", async () => {
    const input = new PassThrough();
    const signal = new AbortController().signal;
    const pending = readSecretStdin(signal, input);
    input.write(Buffer.alloc(1_048_577, 120));
    await expect(pending).rejects.toThrow("serverToken stdin input exceeds its 1 MiB limit.");
    released(input, signal);
  });
});
