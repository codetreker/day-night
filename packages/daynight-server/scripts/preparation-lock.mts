import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

export const withPreparationLock = async <T>(path: string, operation: () => Promise<T>, options: {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
} = {}): Promise<T> => {
  options.signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  let locked = false;
  let failure: unknown;
  try {
    database.exec("PRAGMA busy_timeout=250");
    const deadline = performance.now() + (options.timeoutMs ?? 600_000);
    while (!locked) {
      options.signal?.throwIfAborted();
      try {
        database.exec("BEGIN IMMEDIATE");
        locked = true;
      } catch (error) {
        if (typeof error !== "object" || error === null || !("errcode" in error) || error.errcode !== 5) throw error;
        if (performance.now() >= deadline) throw new Error("UniAuth fixture preparation lock deadline exceeded.", { cause: error });
        await delay(10, undefined, options.signal === undefined ? undefined : { signal: options.signal });
      }
    }
    options.signal?.throwIfAborted();
    return await operation();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const failures: unknown[] = [];
    if (locked) {
      try { database.exec("ROLLBACK"); }
      catch (error) { failures.push(error); }
    }
    try { database.close(); }
    catch (error) { failures.push(error); }
    if (failures.length !== 0) throw new AggregateError(failure === undefined ? failures : [failure, ...failures], "Fixture preparation or lock cleanup failed.");
  }
};
