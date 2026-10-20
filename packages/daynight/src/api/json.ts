const losslessJson = JSON as unknown as {
  parse(text: string, reviver: (key: string, value: unknown, context: { readonly source?: string }) => unknown): unknown;
  rawJSON(text: string): unknown;
};

const maxVersion = 9_223_372_036_854_775_807n;

export const parseVersionArgument = (value: string): bigint => {
  if (!/^[0-9]+$/.test(value)) throw new Error("version must be a positive 64-bit integer.");
  const version = BigInt(value);
  if (version < 1n || version > maxVersion) throw new Error("version must be a positive 64-bit integer.");
  return version;
};

export const parseApiJson = (text: string): unknown => losslessJson.parse(text, (key, value, context) => {
  if (key !== "version" || typeof value !== "number") return value;
  // Go int64 versions must retain their original numeric lexeme past JavaScript's safe integer range.
  const source = context.source;
  return source !== undefined && /^-?[0-9]+$/.test(source) ? BigInt(source) : value;
});

export const stringifyApiJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => {
  if (typeof item !== "bigint") return item;
  if (item < 1n || item > maxVersion) throw new Error("version must be a positive 64-bit integer.");
  return losslessJson.rawJSON(item.toString());
});
