import { request, type ClientRequest, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

export type AuthCombinedTransportCategory = 'configuration' | 'aborted' | 'timeout' | 'transport' | 'response' | 'disconnected' | 'closed';

const messages: Record<AuthCombinedTransportCategory, string> = {
  configuration: 'Invalid combined authentication upload configuration.',
  aborted: 'Combined authentication upload was cancelled.',
  timeout: 'Combined authentication upload exceeded its deadline.',
  transport: 'Combined authentication upload transport failed.',
  response: 'Combined authentication upload response failed.',
  disconnected: 'Combined authentication upload was intentionally disconnected.',
  closed: 'Combined authentication upload was closed.',
};

export class AuthCombinedTransportError extends Error {
  readonly category: AuthCombinedTransportCategory;

  constructor(category: AuthCombinedTransportCategory) {
    super(messages[category]);
    this.category = category;
    this.name = 'AuthCombinedTransportError';
  }
}

export type AuthCombinedUploadResponse = {
  readonly status: number;
  readonly contentType: string;
  readonly requestId: string | undefined;
  readonly body: Buffer;
};

export type AuthCombinedUploadOptions = {
  readonly origin: string;
  readonly path: string;
  readonly token: string;
  readonly body: Buffer;
  readonly prefixBytes: number;
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
};

export type PausedUpload = {
  readonly response: Promise<AuthCombinedUploadResponse>;
  /** Becomes true on a captured response or a failure, including an intentional disconnect. */
  readonly completed: boolean;
  /** Node write callbacks acknowledge these bytes; server admission requires independent observation. */
  readonly sentBytes: number;
  readonly socketClosed: Promise<void>;
  complete(): Promise<AuthCombinedUploadResponse>;
  disconnect(): Promise<void>;
  close(): Promise<void>;
};

const maxBodyBytes = 1_048_576;
const maxResponseBytes = 8 * 1_048_576;
const maxTimeoutMs = 25_000;
const validRequestId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);

export const startAuthCombinedUpload = async (options: AuthCombinedUploadOptions): Promise<PausedUpload> => {
  let origin: URL;
  try { origin = new URL(options.origin); }
  catch { throw new AuthCombinedTransportError('configuration'); }
  const timeoutMs = options.timeoutMs ?? maxTimeoutMs;
  if (origin.origin !== options.origin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.port === ''
    || typeof options.path !== 'string' || !options.path.startsWith('/') || options.path.startsWith('//') || /[?#\x00-\x20\x7f]/.test(options.path)
    || typeof options.token !== 'string' || !/^[\x21-\x7e]+$/.test(options.token) || typeof options.requestId !== 'string' || !validRequestId(options.requestId)
    || options.path.includes(options.token) || options.requestId.includes(options.token)
    || !Buffer.isBuffer(options.body) || options.body.length > maxBodyBytes
    || !Number.isSafeInteger(options.prefixBytes) || options.prefixBytes <= 0 || options.prefixBytes >= options.body.length
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > maxTimeoutMs) {
    throw new AuthCombinedTransportError('configuration');
  }
  if (options.signal.aborted) throw new AuthCombinedTransportError('aborted');

  const body = Buffer.from(options.body);
  const credential = Buffer.from(options.token);
  const ready = Promise.withResolvers<void>();
  const captured = Promise.withResolvers<AuthCombinedUploadResponse>();
  const socketClosure = Promise.withResolvers<void>();
  // These promises remain observable by the caller even when cleanup happens before it starts awaiting them.
  void captured.promise.catch(() => {});
  void socketClosure.promise.catch(() => {});
  let outgoing: ClientRequest | undefined;
  let incoming: IncomingMessage | undefined;
  let socket: Socket | undefined;
  let connected = false;
  let socketIsClosed = false;
  let responseSettled = false;
  let sentBytes = 0;
  let intent: 'disconnected' | 'closed' | undefined;
  let unexpectedFailure: AuthCombinedTransportError | undefined;
  let responseFailure: AuthCombinedTransportError | undefined;
  let pendingWrite: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let completion: Promise<AuthCombinedUploadResponse> | undefined;
  let disconnection: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  const releaseLifecycle = (): void => {
    clearTimeout(deadline);
    options.signal.removeEventListener('abort', abort);
  };
  const maybeReleaseLifecycle = (): void => {
    if (socketIsClosed && responseSettled && pendingWrite === undefined) releaseLifecycle();
  };
  const destroy = (): void => {
    incoming?.destroy();
    outgoing?.destroy();
    socket?.destroy();
  };
  const fail = (category: AuthCombinedTransportCategory): AuthCombinedTransportError => {
    const error = new AuthCombinedTransportError(category);
    if (category !== 'disconnected' && category !== 'closed') unexpectedFailure ??= error;
    if (!responseSettled) {
      responseSettled = true;
      responseFailure = error;
      captured.reject(error);
    }
    ready.reject(unexpectedFailure ?? error);
    pendingWrite?.reject(unexpectedFailure ?? error);
    pendingWrite = undefined;
    destroy();
    maybeReleaseLifecycle();
    return unexpectedFailure ?? error;
  };
  const abort = (): void => { fail('aborted'); };
  const deadline = setTimeout(() => {
    const error = fail('timeout');
    if (!socketIsClosed) socketClosure.reject(error);
    releaseLifecycle();
  }, timeoutMs);
  options.signal.addEventListener('abort', abort, { once: true });

  const write = async (bytes: Buffer): Promise<void> => {
    if (unexpectedFailure !== undefined) throw unexpectedFailure;
    if (intent !== undefined) throw new AuthCombinedTransportError(intent);
    const written = Promise.withResolvers<void>();
    pendingWrite = written;
    try {
      outgoing!.write(bytes, (error) => {
        if (pendingWrite !== written) return;
        pendingWrite = undefined;
        if (error != null) { written.reject(fail(intent ?? 'transport')); return; }
        sentBytes += bytes.length;
        written.resolve();
        maybeReleaseLifecycle();
      });
    } catch { written.reject(fail(intent ?? 'transport')); }
    await written.promise;
  };
  const drain = async (): Promise<void> => {
    destroy();
    await socketClosure.promise;
  };
  const close = (): Promise<void> => closing ??= (async () => {
    if (!responseSettled || pendingWrite !== undefined) {
      intent ??= 'closed';
      fail(intent);
    }
    await drain();
    if (unexpectedFailure !== undefined) throw unexpectedFailure;
  })();

  try {
    outgoing = request({ protocol: 'http:', hostname: '127.0.0.1', port: origin.port,
      path: options.path, method: 'PUT', agent: false,
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/octet-stream',
        'Content-Length': body.length, 'Connection': 'close', 'X-Request-ID': options.requestId },
    });
    outgoing.once('socket', (owned) => {
      socket = owned;
      owned.once('close', () => {
        socketIsClosed = true;
        socketClosure.resolve();
        if (!responseSettled) fail(intent ?? 'transport');
        maybeReleaseLifecycle();
      });
      const sendPrefix = (): void => {
        connected = true;
        void write(body.subarray(0, options.prefixBytes)).then(() => {
          if (responseSettled) ready.reject(responseFailure ?? new AuthCombinedTransportError('response'));
          else if (connected) ready.resolve();
        }, (error: AuthCombinedTransportError) => { ready.reject(error); });
      };
      if (owned.connecting) owned.once('connect', sendPrefix);
      else sendPrefix();
    });
    outgoing.on('error', () => {
      if (!responseSettled) fail(intent ?? 'transport');
    });
    outgoing.once('close', () => {
      if (socket === undefined) {
        socketIsClosed = true;
        socketClosure.resolve();
        maybeReleaseLifecycle();
      }
    });
    outgoing.once('response', (received) => {
      incoming = received;
      const chunks: Buffer[] = [];
      let responseBytes = 0;
      received.on('data', (chunk: Buffer) => {
        if (responseSettled) return;
        responseBytes += chunk.length;
        if (responseBytes > maxResponseBytes) { fail('response'); return; }
        chunks.push(chunk);
      });
      received.once('aborted', () => { if (!responseSettled) fail(intent ?? 'response'); });
      received.on('error', () => { if (!responseSettled) fail(intent ?? 'response'); });
      received.once('end', () => {
        if (responseSettled) return;
        const status = received.statusCode;
        const contentType = received.headers['content-type'] ?? '';
        const identifier = received.headers['x-request-id'];
        const bytes = Buffer.concat(chunks, responseBytes);
        if (!connected || sentBytes < options.prefixBytes || !received.complete || status === undefined || status < 100 || status > 599 || bytes.includes(credential)
          || contentType.includes(options.token) || typeof identifier === 'string' && identifier.includes(options.token)) {
          fail('response'); return;
        }
        responseSettled = true;
        captured.resolve({ status, contentType, requestId: typeof identifier === 'string' && validRequestId(identifier) ? identifier : undefined, body: bytes });
        if (pendingWrite === undefined) destroy();
        else void pendingWrite.promise.then(destroy, destroy);
        maybeReleaseLifecycle();
      });
      received.once('close', () => { if (!responseSettled) fail(intent ?? 'response'); });
    });
    outgoing.flushHeaders();
    if (options.signal.aborted) abort();
  } catch {
    fail('transport');
    if (socket === undefined && outgoing === undefined) {
      socketIsClosed = true;
      socketClosure.resolve();
      maybeReleaseLifecycle();
    }
  }

  try { await ready.promise; }
  catch (error) {
    try { await close(); }
    catch (cleanup) {
      if (cleanup !== error) throw new AggregateError([error, cleanup], 'Combined authentication upload startup and cleanup failed.');
    }
    throw error;
  }
  return {
    response: captured.promise,
    get completed() { return responseSettled; },
    get sentBytes() { return sentBytes; },
    socketClosed: socketClosure.promise,
    complete: () => completion ??= (async () => {
      if (unexpectedFailure !== undefined) throw unexpectedFailure;
      if (intent !== undefined) throw new AuthCombinedTransportError(intent);
      if (!responseSettled) {
        await write(body.subarray(options.prefixBytes));
        if (!outgoing!.destroyed) {
          try { outgoing!.end(); }
          catch { throw fail('transport'); }
        }
      }
      return await captured.promise;
    })(),
    disconnect: () => disconnection ??= (async () => {
      if (!responseSettled || pendingWrite !== undefined) {
        intent ??= 'disconnected';
        fail(intent);
      }
      await drain();
      if (unexpectedFailure !== undefined) throw unexpectedFailure;
    })(),
    close,
  };
};
