const rawJson = JSON as unknown as { rawJSON: (text: string) => unknown };

export const stringifyWireJson = (value: unknown): string => {
  const encoded = JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? rawJson.rawJSON(item.toString()) : item);
  if (encoded === undefined) throw new TypeError("The fixture is not JSON serializable.");
  return encoded;
};

export const wireResponse = (value: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Response(stringifyWireJson(value), { ...init, headers });
};
