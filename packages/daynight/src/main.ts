#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { defaultCliDependencies, formatError, runCli } from "./cli.js";

try {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  process.exitCode = await runCli(process.argv.slice(2), defaultCliDependencies(manifest.version));
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
