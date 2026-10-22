import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import test from 'node:test';
import { inspect } from 'node:util';
import { request } from '@playwright/test';
import { authenticatedAPI, browserFetch } from '../../tests/e2e/authentication.ts';

const cookie = 'daynight_session=dnst_controlled_cookie_marker';
const token = 'dnpat_controlled_bearer_marker';
const fragment = 'dninvite_controlled_fragment_marker';
const requestId = 'f7175b89-52aa-4adb-950e-533597c32517';
const fixture = async (run: (origin: string, observed: { path: string; cookie: string | undefined; authorization: string | undefined }[]) => Promise<void>): Promise<void> => {
  const observed: { path: string; cookie: string | undefined; authorization: string | undefined }[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((incoming, outgoing) => {
    const path = new URL(incoming.url!, 'http://localhost').pathname;
    observed.push({ path, cookie: incoming.headers.cookie, authorization: incoming.headers.authorization });
    if (path === '/reset') { incoming.socket.destroy(); return; }
    if (path === '/timeout') return;
    if (path === '/cookie') outgoing.setHeader('Set-Cookie', `${cookie}; HttpOnly; Path=/`);
    outgoing.setHeader('X-Request-ID', requestId);
    outgoing.setHeader('Content-Type', 'application/json');
    if (path === '/malformed') { outgoing.end(`${token} ${cookie} ${fragment}`); return; }
    outgoing.writeHead(path === '/refusal' ? 409 : 200);
    outgoing.end(JSON.stringify({ value: 'unchanged' }));
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    await run(`http://127.0.0.1:${address.port}`, observed);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
};

const rejection = async (action: () => Promise<unknown>): Promise<Error> => {
  try { await action(); }
  catch (error) { assert.ok(error instanceof Error); return error; }
  throw new Error('The controlled transport operation unexpectedly succeeded.');
};
const diagnostics = (error: Error): string => {
  const seen = new Set<object>();
  const deep = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null) return value;
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    return Object.fromEntries(Reflect.ownKeys(value).map((key) => [String(key), deep(Reflect.get(value, key))]));
  };
  return `${inspect(error, { depth: null, showHidden: true })}\n${JSON.stringify(deep(error))}\n${JSON.stringify({ message: error.message, stack: error.stack, cause: error.cause })}`;
};
const credentialFree = (error: Error): void => {
  const output = diagnostics(error);
  for (const secret of [cookie, token, fragment]) assert.equal(output.includes(secret), false, 'Failure diagnostics contain no controlled credential.');
  assert.equal(Object.hasOwn(error, 'cause'), false);
};

test('browser fetch keeps the real cookie jar while replacing credential-bearing Playwright reset errors', async () => {
  await fixture(async (origin, observed) => {
    const raw = await request.newContext();
    try {
      const fetch = browserFetch(raw);
      assert.equal((await fetch(`${origin}/cookie`)).status, 200);
      const rawFailure = await rejection(() => raw.get(`${origin}/reset`));
      assert.equal(rawFailure.message.includes(cookie), true, 'The regression exercises Playwright cookie call logs.');
      const error = await rejection(() => fetch(`${origin}/reset?token=${token}#${fragment}`));
      credentialFree(error);
      assert.match(error.message, /GET \/reset \(transport\)/);
      assert.equal(observed.filter((entry) => entry.path === '/reset').every((entry) => entry.cookie === cookie), true);
      const aborted = await rejection(() => fetch(`${origin}/reset`, { signal: AbortSignal.abort(new Error(token)) }));
      credentialFree(aborted);
    } finally { await raw.dispose(); }
  });
});

test('all API verbs preserve failures without exposing PAT, request body, query, fragment, or underlying errors', async () => {
  await fixture(async (origin, observed) => {
    const raw = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const api = authenticatedAPI(raw);
    try {
      const rawFailure = await rejection(() => raw.post('/reset', { data: { token: fragment } }));
      assert.equal(rawFailure.message.includes(token), true, 'The regression exercises Playwright Authorization call logs.');
      for (const verb of ['delete', 'fetch', 'get', 'head', 'patch', 'post', 'put'] as const) {
        const error = await rejection(() => api[verb](`/reset?token=${fragment}#${cookie}`, { data: { token } }));
        credentialFree(error);
        assert.equal(Reflect.get(error, 'path'), '/reset');
        assert.equal(Reflect.get(error, 'category'), 'transport');
      }
      const timedOut = await rejection(() => api.get(`/timeout?token=${fragment}`, { timeout: 100 }));
      credentialFree(timedOut);
      assert.equal(Reflect.get(timedOut, 'category'), 'timeout');
      assert.equal(observed.every((entry) => entry.authorization === `Bearer ${token}`), true);
    } finally { await api.dispose(); }
  });
});

test('API responses preserve status, headers, bytes, JSON and HTTP refusals, but malformed JSON diagnostics are safe', async () => {
  await fixture(async (origin) => {
    const api = authenticatedAPI(await request.newContext({ baseURL: origin, extraHTTPHeaders: { Authorization: `Bearer ${token}` } }));
    try {
      const response = await api.post('/refusal', { data: { token } });
      assert.equal(response.status(), 409);
      assert.equal(response.ok(), false);
      assert.equal(response.headers()['x-request-id'], requestId);
      assert.deepEqual(await response.json(), { value: 'unchanged' });
      assert.equal(await response.text(), '{"value":"unchanged"}');
      assert.deepEqual(await response.body(), Buffer.from('{"value":"unchanged"}'));
      const malformed = await api.get('/malformed');
      const error = await rejection(() => malformed.json());
      credentialFree(error);
      assert.equal(Reflect.get(error, 'status'), 200);
      assert.equal(Reflect.get(error, 'requestId'), requestId);
      assert.equal(Reflect.get(error, 'category'), 'response');
      await malformed.dispose();
    } finally { await api.dispose(); }
  });
});
