import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { withCliCancellation } from "../../cli/cancellation.js";
import { createCliContext } from "../../cli/context.js";
import { formatError } from "../../platform/diagnostics.js";
import { refreshInstalledSkills } from "./refresh.js";

try {
  const packageDirectory = fileURLToPath(new URL("../../../", import.meta.url));
  const manifest = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };
  const context = createCliContext(manifest.version, packageDirectory);
  await withCliCancellation(context, (signal) => refreshInstalledSkills(context, signal, { processGroup: "inherit" }));
} catch (cause) {
  process.stderr.write(`${formatError(cause)}\n`);
  process.exitCode = 1;
}
