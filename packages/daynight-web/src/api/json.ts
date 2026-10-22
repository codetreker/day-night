export const isTaskVersion = (value: unknown): value is bigint =>
  typeof value === "bigint" && value > 0n && value <= 9_223_372_036_854_775_807n;

export const parseApiJson = (text: string): unknown => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return parsed;
  const numberToken = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  let offset = 0;
  let depth = 0;
  let versionSource: string | undefined;
  // Only full-task responses carry a root version. Preserve its source digits without
  // requiring the newer JSON reviver context API or changing unknown nested data.
  while (offset < text.length) {
    switch (text[offset]) {
      case '"': {
        const start = offset++;
        while (text[offset] !== '"') offset += text[offset] === '\\' ? 2 : 1;
        offset++;
        if (depth !== 1) break;
        let valueStart = offset;
        while (/[\t\n\r ]/.test(text[valueStart] ?? '')) valueStart++;
        if (text[valueStart] !== ':' || JSON.parse(text.slice(start, offset)) !== 'version') break;
        valueStart++;
        while (/[\t\n\r ]/.test(text[valueStart] ?? '')) valueStart++;
        numberToken.lastIndex = valueStart;
        const source = numberToken.exec(text)?.[0];
        versionSource = source !== undefined && /^-?[0-9]+$/.test(source) ? source : undefined;
        break;
      }
      case '{': case '[': depth++; offset++; break;
      case '}': case ']': depth--; offset++; break;
      default: offset++;
    }
  }
  const data = parsed as Record<string, unknown>;
  if (versionSource !== undefined && typeof data.version === 'number') data.version = BigInt(versionSource);
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
