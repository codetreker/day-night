#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli/application.js";
import { createCliContext } from "./cli/context.js";
import { formatError } from "./platform/diagnostics.js";

try {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
  process.exitCode = await runCli(process.argv.slice(2), createCliContext(manifest.version, packageDirectory));
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
