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
child.once("error", (cause) => { failure = cause.message; });
child.once("close", (code, signal) => {
  closeSync(output);
  writeFileSync(configuration.resultPath, JSON.stringify({
    code, signal, failure, launcherPid: child.pid,
    stdinTerminal: process.stdin.isTTY === true,
    stderrTerminal: process.stderr.isTTY === true,
    stdoutTerminal,
  }));
});
