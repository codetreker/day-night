import { parseConfigurationDocument } from "./document.js";
import { readConfigurationSource } from "./files.js";
import type { ConfigurationPaths } from "./paths.js";

export type ServerConfiguration = { serverUrl: string };

export const normalizeServerUrl = (value: unknown): string => {
  const invalid = (): Error => new Error("serverUrl must be an HTTP(S) origin without credentials, a non-root path, query, fragment, whitespace, or backslashes.");
  if (typeof value !== "string" || !/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f-\u009f\\?#]/u.test(value)) {
    throw invalid();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new Error("serverUrl must be a valid HTTP(S) origin.", { cause });
  }
  const authority = value.slice(value.indexOf("://") + 3);
  if (authority.includes("@") || /\//.test(authority.replace(/\/$/, "")) || !["http:", "https:"].includes(url.protocol) || url.hostname === "" || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw invalid();
  }
  return url.origin;
};

export const parseServerConfiguration = (source: string, paths: ConfigurationPaths): ServerConfiguration => {
  try {
    const { mapping } = parseConfigurationDocument(source, paths);
    if (!Object.hasOwn(mapping, "serverUrl")) {
      throw new Error("serverUrl is not configured; set it to the daynight-server HTTP(S) origin.");
    }
    return { serverUrl: normalizeServerUrl(mapping.serverUrl) };
  } catch (cause) {
    throw new Error(`Invalid configuration file ${paths.configFile}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
};

export const loadServerConfiguration = async (paths: ConfigurationPaths, signal?: AbortSignal): Promise<ServerConfiguration> =>
  parseServerConfiguration(await readConfigurationSource(paths, signal), paths);
