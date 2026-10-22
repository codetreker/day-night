import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { login } from '../../scripts/acceptance/auth-fixture.mts';

export const browserAuthentication = async (context: BrowserContext, origin: string, persona = 'alice'): Promise<void> => {
  const transport: typeof globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (init.body !== undefined && typeof init.body !== 'string') throw new Error('Browser authentication accepts only protocol string bodies.');
    init.signal?.throwIfAborted();
    const response = await context.request.fetch(url, {
      method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)),
      ...(init.body === undefined ? {} : { data: init.body }), maxRedirects: 0, failOnStatusCode: false, timeout: 10_000,
    });
    init.signal?.throwIfAborted();
    const headers = new Headers();
    for (const header of response.headersArray()) headers.append(header.name, header.value);
    const body = [204, 205, 304].includes(response.status()) ? null : Uint8Array.from(await response.body()).buffer;
    return new Response(body, { status: response.status(), headers });
  };
  await login({ origin, persona, fetch: transport });
};

export const bearerContext = async (request: { newContext: (options: { baseURL: string; extraHTTPHeaders: Record<string, string> }) => Promise<APIRequestContext> },
  origin: string, persona = 'alice'): Promise<APIRequestContext> => {
  const session = await login({ origin, persona });
  const token = await session.createPAT('Browser acceptance');
  return await request.newContext({ baseURL: origin, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
};
