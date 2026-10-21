import { performance } from "node:perf_hooks";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { runNativeServiceCommand } from "./service.js";

const workspace = path.resolve(import.meta.dirname, "../../../..");

it.skipIf(process.platform !== "linux")("bounds command timeout and kills descendants retaining its output pipes", async () => {
  const temporary = path.join(workspace, ".tmp");
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(path.join(temporary, "native-service-process-"));
  const pidFile = path.join(root, "pids.json");
  let owned: { leader: number; descendant: number } | undefined;
  try {
    const script = `
      const {spawn} = require('node:child_process');
      const {writeFileSync} = require('node:fs');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit'});
      writeFileSync(process.argv[1], JSON.stringify({leader: process.pid, descendant: child.pid}));
      setInterval(() => {}, 1000);
    `;
    const started = performance.now();
    const command = runNativeServiceCommand("Inherited-pipe probe", process.execPath, ["-e", script, pidFile], { cwd: root, timeoutMs: 500 });
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(Promise.race([command, new Promise<never>((_resolve, reject) => { watchdog = setTimeout(() => reject(new Error("Process-tree cleanup did not finish within its bound.")), 3_000); })])).rejects.toThrow("Inherited-pipe probe exceeded its deadline.");
    } finally { if (watchdog !== undefined) clearTimeout(watchdog); }
    expect(performance.now() - started).toBeLessThan(3_000);
    owned = JSON.parse(await readFile(pidFile, "utf8")) as typeof owned;
    expect(owned).toBeDefined();
    for (const pid of [owned!.leader, owned!.descendant]) {
      try {
        const state = await readFile(`/proc/${pid}/stat`, "utf8");
        expect(state.slice(state.lastIndexOf(") ") + 2, state.lastIndexOf(") ") + 3)).toBe("Z");
      } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    }
  } finally {
    if (owned === undefined) {
      try { owned = JSON.parse(await readFile(pidFile, "utf8")) as typeof owned; }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    }
    if (owned !== undefined) {
      for (const pid of [-owned.leader, owned.descendant]) {
        try { process.kill(pid, "SIGKILL"); }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});
