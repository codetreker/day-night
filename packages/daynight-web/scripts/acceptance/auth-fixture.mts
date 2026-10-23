import type { ChildProcess } from 'node:child_process';

export type AuthFixture = {
  readonly origin: string;
  readonly appId: string;
  readonly appSecret: string;
  readonly child: ChildProcess;
  close(): Promise<void>;
};
type FixtureOptions = {
  readonly binary: string;
  readonly directory: string;
  readonly callbackURL: string;
  readonly listenAddress?: string;
  readonly publicOrigin?: string;
  readonly signal?: AbortSignal;
  readonly onSpawn?: (child: ChildProcess) => Promise<void>;
};
type LoginOptions = { readonly origin: string; readonly persona?: string; readonly signal?: AbortSignal; readonly fetch?: typeof globalThis.fetch };
type AuthenticatedFixture = {
  readonly cookie: string;
  request(path: string, init?: RequestInit): Promise<Response>;
  createPAT(name?: string, days?: number): Promise<string>;
};
type FixtureModule = {
  reserveLoopbackPort(): Promise<number>;
  startAuthFixture(options: FixtureOptions): Promise<AuthFixture>;
  login(options: LoginOptions): Promise<AuthenticatedFixture>;
};

let loadedFixture: Promise<FixtureModule> | undefined;
const fixture = (): Promise<FixtureModule> => loadedFixture ??= (async () => {
  // The Web image type-checks acceptance sources without including server test tooling.
  const implementation = await import(new URL('../../../daynight-server/scripts/auth-fixture.mts', import.meta.url).href) as FixtureModule;
  for (const name of ['reserveLoopbackPort', 'startAuthFixture', 'login'] as const) {
    if (typeof implementation[name] !== 'function') throw new Error('The canonical authentication fixture is unavailable.');
  }
  return implementation;
})();

export const reserveLoopbackPort = async (): Promise<number> => await (await fixture()).reserveLoopbackPort();
export const startAuthFixture = async (options: FixtureOptions): Promise<AuthFixture> => await (await fixture()).startAuthFixture(options);
export const login = async (options: LoginOptions): Promise<AuthenticatedFixture> => await (await fixture()).login(options);
