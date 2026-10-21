import { OUTPUT_CHUNK_BYTES, writeOutputBytes } from "./byte-output.js";

const send = (message: { readonly type: "written" } | { readonly type: "error"; readonly message: string; readonly code?: string }): Promise<void> => new Promise((resolve, reject) => {
  if (process.send === undefined) { reject(new Error("Binary output helper requires an IPC channel.")); return; }
  process.send(message, (error) => error === null ? resolve() : reject(error));
});

const run = async (): Promise<void> => {
  let pending: Buffer = Buffer.alloc(0);
  let length: number | undefined;
  const signal = new AbortController().signal;
  for await (const chunk of process.stdin) {
    pending = pending.byteLength === 0 ? chunk as Buffer : Buffer.concat([pending, chunk as Buffer]);
    while (true) {
      if (length === undefined) {
        if (pending.byteLength < 4) break;
        length = pending.readUInt32BE();
        pending = pending.subarray(4);
        if (length > OUTPUT_CHUNK_BYTES) throw new Error("Binary output frame exceeds the chunk limit.");
      }
      if (pending.byteLength < length) break;
      await writeOutputBytes(process.stdout, pending.subarray(0, length), signal);
      pending = pending.subarray(length);
      length = undefined;
      await send({ type: "written" });
    }
  }
  if (pending.byteLength !== 0 || length !== undefined) throw new Error("Binary output helper received an incomplete frame.");
};

try { await run(); }
catch (cause) {
  process.exitCode = 1;
  const error = cause instanceof Error ? cause : new Error(String(cause));
  await send({ type: "error", message: error.message, ...("code" in error && typeof error.code === "string" ? { code: error.code } : {}) });
} finally {
  process.stdin.destroy();
  if (process.connected) process.disconnect();
}
