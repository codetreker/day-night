import { closeSync, openSync, writeFileSync } from "node:fs";
import { isatty } from "node:tty";
import crossSpawn from "cross-spawn";

const configuration = JSON.parse(process.argv[2]);
const output = openSync(configuration.stdoutPath, "w");
const stdoutTerminal = isatty(output);
const child = crossSpawn(configuration.launcherPath, configuration.args, {
  cwd: configuration.cwd,
  env: process.env,
  stdio: ["inherit", output, "inherit"],
  windowsHide: true,
});
let failure;
let launcherExit;
child.once("error", (cause) => { failure = cause.message; });
// The original child's exit identifies the process; Windows may reuse its PID before the PTY finishes draining.
// https://github.com/nodejs/node/blob/f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93/lib/internal/child_process.js#L300-L335
// https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers
child.once("exit", (code, signal) => { launcherExit = { code, signal }; });
child.once("close", (code, signal) => {
  closeSync(output);
  writeFileSync(configuration.resultPath, JSON.stringify({
    code, signal, failure, launcherPid: child.pid, launcherExit,
    stdinTerminal: process.stdin.isTTY === true,
    stderrTerminal: process.stderr.isTTY === true,
    stdoutTerminal,
  }));
});
