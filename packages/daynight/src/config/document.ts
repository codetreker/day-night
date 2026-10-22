import { parseDocument } from "yaml";
import { readConfigurationSource } from "./files.js";
import type { ConfigurationPaths } from "./paths.js";

export type ConfigurationDocument = {
  document: ReturnType<typeof parseDocument>;
  mapping: Record<string, unknown>;
};

export const supportedConfigurationFields = [
  "serverUrl",
  "repositoryRoot",
  "repositories",
  "pollIntervalMs",
  "maxConcurrentWorker",
  "agentTimeoutMs",
  "maxAttempts",
  "retryDelayMs",
  "copilotModel",
] as const;

export const parseConfigurationDocument = (
  source: string,
  paths: ConfigurationPaths,
): ConfigurationDocument => {
  const document = parseDocument(source, {
    strict: true,
    uniqueKeys: true,
    stringKeys: true,
    prettyErrors: false,
  });
  const problems = [...document.errors, ...document.warnings];
  if (problems.length !== 0) {
    throw new Error(`Invalid YAML in ${paths.configFile}.`, {
      cause: new AggregateError(problems, "YAML configuration was rejected."),
    });
  }
  let parsed: unknown;
  try {
    parsed = document.toJS();
  } catch (cause) {
    throw new Error(`Cannot decode YAML in ${paths.configFile}.`, { cause });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Configuration must be a mapping.");
  }
  const mapping = parsed as Record<string, unknown>;
  for (const field of Object.keys(mapping)) {
    if (!(supportedConfigurationFields as readonly string[]).includes(field)) {
      throw new Error(`Configuration contains unsupported field ${JSON.stringify(field)}.`);
    }
  }
  return { document, mapping };
};

export const readConfiguration = async (paths: ConfigurationPaths): Promise<ConfigurationDocument> =>
  parseConfigurationDocument(await readConfigurationSource(paths), paths);
