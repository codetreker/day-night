import { jsonObjectSources } from "./json-source";

export const isTaskVersion = (value: unknown): value is bigint =>
  typeof value === "bigint" && value > 0n && value <= 9_223_372_036_854_775_807n;

export const parseApiJson = (text: string): unknown => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return parsed;
  const data = parsed as Record<string, unknown>;
  const versionSource = jsonObjectSources(text).get('version');
  if (versionSource !== undefined && /^-?[0-9]+$/.test(versionSource) && typeof data.version === 'number') {
    data.version = BigInt(versionSource);
  }
  return parsed;
};

export const stringifyApiJson = (value: unknown): string => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'version' in value && typeof value.version === 'bigint') {
    const version = value.version;
    if (!isTaskVersion(version)) throw new Error("version must be a positive 64-bit integer.");
    const members = Object.entries(value).flatMap(([key, item]) => {
      const encoded = key === 'version' ? version.toString() : JSON.stringify(item);
      return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`];
    });
    return `{${members.join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("The value is not JSON serializable.");
  return encoded;
};
