export const jsonStringEnd = (text: string, start: number): number => {
  let offset = start + 1;
  while (text[offset] !== '"') offset += text[offset] === '\\' ? 2 : 1;
  return offset + 1;
};

// Source spans are inspected only after native parsing validates the complete document.
export const jsonContainerSources = (text: string): string[] => {
  const source = text.trim();
  const values: string[] = [];
  let start = 1;
  let depth = 0;
  for (let offset = 1; offset < source.length; offset++) {
    const token = source[offset];
    if (token === '"') { offset = jsonStringEnd(source, offset) - 1; continue; }
    if (token === '{' || token === '[') { depth++; continue; }
    if (token === '}' || token === ']') {
      if (depth > 0) { depth--; continue; }
      const value = source.slice(start, offset).trim();
      if (value !== '') values.push(value);
      return values;
    }
    if (token === ',' && depth === 0) { values.push(source.slice(start, offset).trim()); start = offset + 1; }
  }
  return values;
};

export const jsonObjectSources = (text: string): ReadonlyMap<string, string> => new Map(jsonContainerSources(text).map((field) => {
  const end = jsonStringEnd(field, 0);
  return [JSON.parse(field.slice(0, end)) as string, field.slice(end).trimStart().slice(1).trim()];
}));
