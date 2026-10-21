import type { spawn as Spawn } from "node:child_process";
import type { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

export const OUTPUT_CHUNK_BYTES = 65_536;

export const writeOutputBytes = (output: Writable, chunk: Uint8Array, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  if (output.errored !== null) { reject(output.errored); return; }
  if (!output.writable) { reject(new Error("Binary stdout is closed.")); return; }
  let settled = false;
  const cleanup = (): void => {
    signal.removeEventListener("abort", abort);
    output.off("error", fail);
    output.off("close", closed);
  };
  const finish = (error?: unknown): void => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error === undefined) resolve();
    else reject(error);
  };
  const fail = (error: Error): void => finish(error);
  const closed = (): void => finish(new Error("Binary stdout closed before its pending write completed."));
  const abort = (): void => { output.destroy(); finish(signal.reason); };
  output.on("error", fail);
  output.on("close", closed);
  signal.addEventListener("abort", abort, { once: true });
  try {
    output.write(chunk, (error) => {
      // Writable emits callback failures as error events after invoking the callback.
      if (error === null || error === undefined) finish();
    });
  } catch (cause) { finish(cause); }
});

type Exit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
type Acknowledgement = { readonly resolve: () => void; readonly reject: (cause: unknown) => void };

const startOutputHelper = (spawn: typeof Spawn) => {
  const helperPath = fileURLToPath(new URL("./byte-output-helper.js", import.meta.url));
  // fd 1 writes can block JavaScript on Windows and TTYs. Only this owned child writes file content.
  // https://github.com/nodejs/node/blob/cdc1b38d40cb567b7ad0b39c86addf830a0af0ae/doc/api/process.md#a-note-on-process-io
  const child = spawn(process.execPath, [helperPath], { stdio: ["pipe", "inherit", "ignore", "ipc"], windowsHide: true });
  const input = child.stdin;
  if (input === null) throw new Error("The binary output helper has no input pipe.");
  let acknowledgement: Acknowledgement | undefined;
  let failure: Error | undefined;
  let exit: Exit | undefined;
  let terminated = false;
  let termination: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const exited = new Promise<Exit>((resolve) => {
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      acknowledgement?.reject(failure === undefined ? new Error(`Binary output helper exited before confirming its write (code=${code}, signal=${signal}).`) : failure);
    });
    child.once("close", (code, signal) => { exit = { code, signal }; resolve(exit); });
    child.once("error", (cause) => {
      failure = cause;
      acknowledgement?.reject(cause);
    });
  });
  child.on("message", (message: unknown) => {
    if (typeof message !== "object" || message === null || !("type" in message)) {
      failure = new Error("The binary output helper sent an invalid acknowledgement.");
    } else if (message.type === "written") {
      acknowledgement?.resolve();
      return;
    } else if (message.type === "error" && "message" in message && typeof message.message === "string") {
      failure = new Error(message.message);
      if ("code" in message && typeof message.code === "string") Object.assign(failure, { code: message.code });
    } else failure = new Error("The binary output helper sent an invalid acknowledgement.");
    acknowledgement?.reject(failure);
  });
  const waitForExit = async (): Promise<Exit> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([exited, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Binary output helper exceeded its 5 second exit deadline.")), 5_000);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  const terminate = (): Promise<void> => termination ??= (async () => {
    terminated = true;
    input.destroy();
    if (exit === undefined) child.kill("SIGKILL");
    await waitForExit();
  })();
  return {
    write: async (chunk: Uint8Array, signal: AbortSignal): Promise<void> => {
      if (signal.aborted) throw signal.reason;
      if (failure !== undefined) throw failure;
      if (exit !== undefined || closing !== undefined) throw new Error("The binary output helper is closed.");
      if (acknowledgement !== undefined) throw new Error("A binary stdout write is already in progress.");
      let abort = (): void => {};
      try {
        const confirmed = new Promise<void>((resolve, reject) => { acknowledgement = { resolve, reject }; });
        const aborted = new Promise<never>((_resolve, reject) => {
          abort = () => { void terminate().then(() => reject(signal.reason), (cleanup: unknown) => reject(new AggregateError([signal.reason, cleanup], "Binary stdout cancellation cleanup failed.", { cause: signal.reason }))); };
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
        const frame = Buffer.allocUnsafe(4 + chunk.byteLength);
        frame.writeUInt32BE(chunk.byteLength);
        frame.set(chunk, 4);
        await Promise.race([Promise.all([writeOutputBytes(input, frame, signal), confirmed]), aborted]);
      } catch (cause) {
        const primary = signal.aborted ? signal.reason : cause;
        try { await terminate(); }
        catch (cleanup) { throw new AggregateError([primary, cleanup], "Binary stdout write and helper cleanup failed.", { cause: primary }); }
        throw primary;
      } finally {
        signal.removeEventListener("abort", abort);
        acknowledgement = undefined;
      }
    },
    close: (): Promise<void> => closing ??= (async () => {
      if (termination !== undefined) { await termination; return; }
      input.end();
      try {
        const result = await waitForExit();
        if (failure !== undefined) throw failure;
        if (!terminated && result.code !== 0) throw new Error(`Binary output helper failed (code=${result.code}, signal=${result.signal}).`);
      } catch (cause) {
        try { await terminate(); }
        catch (cleanup) { throw new AggregateError([cause, cleanup], "Binary stdout helper shutdown failed.", { cause }); }
        throw cause;
      }
    })(),
  };
};

export const createByteOutput = () => {
  let helper: ReturnType<typeof startOutputHelper> | undefined;
  let closed = false;
  return {
    write: async (chunk: Uint8Array, signal: AbortSignal): Promise<void> => {
      if (signal.aborted) throw signal.reason;
      if (closed) throw new Error("Binary stdout is closed.");
      for (let offset = 0; offset < chunk.byteLength; offset += OUTPUT_CHUNK_BYTES) {
        if (helper === undefined) {
          const { spawn } = await import("node:child_process");
          if (signal.aborted) throw signal.reason;
          if (closed) throw new Error("Binary stdout is closed.");
          helper ??= startOutputHelper(spawn);
        }
        await helper.write(chunk.subarray(offset, offset + OUTPUT_CHUNK_BYTES), signal);
      }
    },
    close: async (): Promise<void> => { closed = true; if (helper !== undefined) await helper.close(); },
  };
};
