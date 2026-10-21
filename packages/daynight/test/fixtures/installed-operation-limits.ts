import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type DeadlineLimits = { readonly totalMs: number; readonly requestMs: number };

export const createInstalledDeadlineMock = async (directory: string, entryPath: string, limits: DeadlineLimits): Promise<string> => {
  const operationUrl = pathToFileURL(await realpath(path.join(path.dirname(entryPath), "api/operation.js")));
  const actualUrl = new URL(operationUrl);
  actualUrl.searchParams.set("acceptance-original", "1");
  const wrapper = `
import { deepStrictEqual } from "node:assert/strict";
import { createOperation as actualCreateOperation, DEFAULT_OPERATION_LIMITS } from ${JSON.stringify(actualUrl.href)};
export * from ${JSON.stringify(actualUrl.href)};
deepStrictEqual(DEFAULT_OPERATION_LIMITS, { totalMs: 300000, requestMs: 30000, responseBytes: 134217728, totalBytes: 268435456 });
export const createOperation = (options = {}) => {
  const expected = { ...DEFAULT_OPERATION_LIMITS, ...${JSON.stringify(limits)}, ...options.limits };
  const operation = actualCreateOperation({ ...options, limits: expected });
  deepStrictEqual(operation.limits, expected);
  return operation;
};
`;
  // Load the unchanged installed module through a distinct URL so every consumer shares its error classes.
  const preload = `
import { registerHooks } from "node:module";
registerHooks({
  load(url, context, nextLoad) {
    if (url !== ${JSON.stringify(operationUrl.href)}) return nextLoad(url, context);
    return { format: "module", source: ${JSON.stringify(wrapper)}, shortCircuit: true };
  },
});
`;
  const mockPath = path.join(directory, "installed-deadline-mock.mjs");
  await writeFile(mockPath, preload);
  return mockPath;
};
