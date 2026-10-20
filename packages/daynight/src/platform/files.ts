import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import path from "node:path";

export const replaceFileAtomically = async (
  file: string,
  contents: string | Uint8Array,
  mode?: number,
): Promise<void> => {
  const temporaryFile = path.join(path.dirname(file), `.atomic-${randomUUID()}.tmp`);
  const handle = await open(temporaryFile, "wx", 0o600);
  let failure: unknown;
  let renamed = false;
  let closed = false;
  try {
    await handle.writeFile(contents);
    if (mode !== undefined) {
      await handle.chmod(mode & 0o777);
    }
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(temporaryFile, file);
    renamed = true;
  } catch (cause) {
    failure = cause;
    throw cause;
  } finally {
    const cleanup: unknown[] = [];
    if (!closed) {
      try { await handle.close(); } catch (cause) { cleanup.push(cause); }
    }
    if (!renamed) {
      try { await unlink(temporaryFile); } catch (cause) { cleanup.push(cause); }
    }
    if (cleanup.length !== 0) {
      throw new AggregateError(failure === undefined ? cleanup : [failure, ...cleanup], `Atomic replacement or temporary-file cleanup failed for ${file}.`);
    }
  }
};

