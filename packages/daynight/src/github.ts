import { execFile } from "node:child_process";
import type { RepositoryConfiguration } from "./config.js";
import type { PullRequestObservation, RepositoryIdentity, RepositoryState, Store } from "./store.js";

export type CommandOptions = {
  timeoutMs: number;
  maxBufferBytes: number;
  signal?: AbortSignal;
  environment?: { GH_ENTERPRISE_TOKEN: string };
};
export type CommandResult = { stdout: string; stderr: string; error: Error | null };
export type CommandExecutor = (file: string, args: readonly string[], options: CommandOptions) => Promise<CommandResult>;
export type GitHubRepository = RepositoryIdentity & { owner: string; name: string };
export type GitHubClient = {
  resolveRepository: (configuration: RepositoryConfiguration, signal?: AbortSignal) => Promise<GitHubRepository>;
  listPullRequestNumbers: (repository: GitHubRepository, signal?: AbortSignal) => Promise<number[]>;
  listOpenPullRequests: (repository: GitHubRepository, cutoff: number, signal?: AbortSignal) => Promise<PullRequestObservation[]>;
  getPullRequest: (repository: GitHubRepository, number: number, signal?: AbortSignal) => Promise<PullRequestObservation>;
};

export class GitHubApiError extends Error {
  readonly status: number | null;
  readonly retryAt: number | null;

  constructor(message: string, options: { status?: number; retryAt?: number | null; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "GitHubApiError";
    this.status = options.status === undefined ? null : options.status;
    this.retryAt = options.retryAt === undefined ? null : options.retryAt;
  }
}

export const executeCommand: CommandExecutor = (file, args, options) => new Promise((resolve) => {
  const env: NodeJS.ProcessEnv = { ...process.env, GH_PROMPT_DISABLED: "1", GH_FORCE_TTY: "", NO_COLOR: "1", PAGER: "cat", GH_PAGER: "cat", ...options.environment };
  delete env.GH_DEBUG;
  execFile(file, [...args], {
    encoding: "utf8", windowsHide: true, timeout: options.timeoutMs, maxBuffer: options.maxBufferBytes,
    env, ...(options.signal === undefined ? {} : { signal: options.signal }),
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
});

type HttpResponse = { status: number; headers: Map<string, string[]>; body: unknown };
const object = (value: unknown, subject: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${subject} must be an object.`);
  return value as Record<string, unknown>;
};
const positiveInteger = (value: unknown, subject: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${subject} must be a positive safe integer.`);
  return value;
};
const text = (value: unknown, subject: string): string => {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n\0]/.test(value)) throw new Error(`${subject} must be nonempty text without control characters.`);
  return value;
};
const pullRequestNumber = (value: unknown): number => positiveInteger(object(value, "PR").number, "PR number");
const observation = (value: unknown): PullRequestObservation => {
  const data = object(value, "PR");
  const number = pullRequestNumber(data);
  if (data.state !== "open" && data.state !== "closed") throw new Error(`PR ${number} has an invalid state.`);
  if (typeof data.draft !== "boolean") throw new Error(`PR ${number} has an invalid Draft flag.`);
  if (data.merged_at !== null && (typeof data.merged_at !== "string" || !Number.isFinite(Date.parse(data.merged_at)))) throw new Error(`PR ${number} has an invalid merge time.`);
  if (data.merged !== undefined && typeof data.merged !== "boolean") throw new Error(`PR ${number} has an invalid merged flag.`);
  const merged = data.merged_at !== null || data.merged === true;
  if (merged && data.state !== "closed") throw new Error(`PR ${number} is merged but not closed.`);
  if (data.merged === false && data.merged_at !== null) throw new Error(`PR ${number} has inconsistent merge fields.`);
  const head = object(data.head, `PR ${number} head`);
  const base = object(data.base, `PR ${number} base`);
  return {
    number, state: merged ? "merged" : data.state, draft: data.draft,
    headSha: text(head.sha, `PR ${number} head SHA`), baseRef: text(base.ref, `PR ${number} base branch`),
    baseSha: text(base.sha, `PR ${number} base SHA`),
  };
};

const parseResponse = (stdout: string): HttpResponse => {
  const separator = /\r?\n\r?\n/.exec(stdout);
  if (separator === null) throw new Error("GitHub CLI output has no complete HTTP header block.");
  const lines = stdout.slice(0, separator.index).split(/\r?\n/);
  const statusLine = /^HTTP\/\d(?:\.\d)? ([1-5]\d\d)(?: [^\r\n]*)?$/.exec(lines.shift()!);
  if (statusLine === null) throw new Error("GitHub CLI output has an invalid HTTP status line.");
  const headers = new Map<string, string[]>();
  for (const line of lines) {
    const match = /^([!#$%&'*+.^_`|~\da-z-]+):[ \t]*(.*)$/i.exec(line);
    if (match === null) throw new Error("GitHub CLI output has an invalid HTTP header.");
    const key = match[1]!.toLowerCase();
    const values = headers.get(key);
    if (values === undefined) headers.set(key, [match[2]!]); else values.push(match[2]!);
  }
  return { status: Number(statusLine[1]), headers, body: JSON.parse(stdout.slice(separator.index + separator[0].length)) as unknown };
};
const apiBase = (host: string): URL => {
  const origin = new URL(`https://${host}`);
  if (origin.host === "github.com") return new URL("https://api.github.com/");
  if (origin.host.endsWith(".ghe.com")) return new URL(`https://api.${origin.host}/`);
  return new URL(`https://${origin.host}/api/v3/`);
};
const rateLimitRetryAt = (response: HttpResponse, now: number): number | null => {
  if (response.status !== 403 && response.status !== 429) return null;
  const retryAfter = response.headers.get("retry-after") ?? [];
  const remaining = response.headers.get("x-ratelimit-remaining") ?? [];
  const body = typeof response.body === "object" && response.body !== null ? response.body as Record<string, unknown> : {};
  const secondary = typeof body.message === "string" && /rate limit|abuse detection/i.test(body.message);
  if (response.status !== 429 && !remaining.includes("0") && retryAfter.length === 0 && !secondary) return null;
  const deadlines = [now + 60_000];
  for (const value of retryAfter) {
    const deadline = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
    if (!Number.isSafeInteger(deadline)) throw new Error("GitHub returned an invalid Retry-After deadline.");
    deadlines.push(deadline);
  }
  if (remaining.includes("0")) {
    for (const value of response.headers.get("x-ratelimit-reset") ?? []) {
      const deadline = /^\d+$/.test(value) ? Number(value) * 1000 : NaN;
      if (!Number.isSafeInteger(deadline)) throw new Error("GitHub returned an invalid rate-limit reset deadline.");
      deadlines.push(deadline);
    }
  }
  return Math.max(...deadlines);
};
type PaginationLink = { target: string; relations: string[] };
const parseLinks = (header: string): PaginationLink[] => {
  const links: PaginationLink[] = [];
  let position = 0;
  const invalid = (): never => { throw new Error("GitHub returned an invalid pagination Link header."); };
  const whitespace = (): void => { while (header[position] === " " || header[position] === "\t") position++; };
  const token = (): string => {
    const start = position;
    while (position < header.length && /[!#$%&'*+.^_`|~\da-z-]/i.test(header[position]!)) position++;
    if (position === start) invalid();
    return header.slice(start, position);
  };
  const value = (): string => {
    if (header[position] !== '"') return token();
    position++;
    let result = "";
    while (position < header.length) {
      let character = header[position++]!;
      if (character === '"') return result;
      if (character === "\\") {
        if (position === header.length) invalid();
        character = header[position++]!;
      }
      const code = character.charCodeAt(0);
      if ((code < 32 && code !== 9) || code === 127) invalid();
      result += character;
    }
    return invalid();
  };
  whitespace();
  while (position < header.length) {
    if (header[position++] !== "<") invalid();
    const start = position;
    while (position < header.length && header[position] !== ">") {
      if (/[\x00-\x20\x7f<]/.test(header[position]!)) invalid();
      position++;
    }
    if (position === header.length) invalid();
    const target = header.slice(start, position++);
    let relations: string[] = [];
    let hasRelation = false;
    whitespace();
    while (position < header.length && header[position] !== ",") {
      if (header[position++] !== ";") invalid();
      whitespace();
      const name = token().toLowerCase();
      whitespace();
      let parameter: string | null = null;
      if (header[position] === "=") {
        position++;
        whitespace();
        parameter = value();
        whitespace();
      }
      // Later rel parameters are ignored: https://www.rfc-editor.org/rfc/rfc8288.html#section-3.3
      if (name === "rel" && !hasRelation) {
        if (parameter === null || parameter === "" || parameter.trim() !== parameter) invalid();
        hasRelation = true;
        relations = parameter!.split(/ +/);
        for (const relation of relations) {
          if (/^[a-z][a-z\d.-]*$/i.test(relation)) continue;
          try { new URL(relation); } catch { invalid(); }
        }
      }
    }
    links.push({ target, relations });
    if (position === header.length) break;
    position++;
    whitespace();
    if (position === header.length) invalid();
  }
  if (links.length === 0) invalid();
  return links;
};
const nextPage = (response: HttpResponse, current: URL, repository: GitHubRepository, scan: URL): URL | null => {
  let next: URL | null = null;
  for (const header of response.headers.get("link") ?? []) {
    for (const entry of parseLinks(header)) {
      if (!entry.relations.some((relation) => relation.toLowerCase() === "next")) continue;
      if (next !== null) throw new Error("GitHub returned more than one next page.");
      const url = new URL(entry.target);
      const base = apiBase(repository.host);
      const prefix = base.pathname;
      const allowed = [`${prefix}repos/${repository.owner}/${repository.name}/pulls`, `${prefix}repositories/${repository.githubId}/pulls`];
      if (url.protocol !== "https:" || url.origin !== base.origin || url.username !== "" || url.password !== "" || url.hash !== "" || !allowed.includes(url.pathname)) {
        throw new Error("GitHub pagination points outside the expected repository API.");
      }
      const keys = new Set([...scan.searchParams.keys(), ...url.searchParams.keys()]);
      for (const key of keys) {
        const values = url.searchParams.getAll(key);
        if (key !== "page" && (values.length !== 1 || values[0] !== scan.searchParams.get(key))) throw new Error("GitHub pagination changed scan parameters.");
      }
      const pages = url.searchParams.getAll("page");
      if (pages.length !== 1 || !/^[1-9]\d*$/.test(pages[0]!) || !Number.isSafeInteger(Number(pages[0])) || Number(pages[0]) <= Number(current.searchParams.get("page"))) {
        throw new Error("GitHub pagination did not advance to a later page.");
      }
      next = url;
    }
  }
  return next;
};
// Credential command errors may contain captured output, so only process metadata is retained.
const sanitizedProcessError = (error: unknown): Error => {
  const sanitized = new Error("GitHub CLI did not complete successfully.");
  if (typeof error === "object" && error !== null) {
    const failure = error as Record<string, unknown>;
    if (typeof failure.code === "number" || (typeof failure.code === "string" && /^[A-Z][A-Z\d_]*$/.test(failure.code))) Object.assign(sanitized, { code: failure.code });
    if (typeof failure.killed === "boolean") Object.assign(sanitized, { killed: failure.killed });
    if (failure.signal === null || (typeof failure.signal === "string" && /^SIG[A-Z\d]+$/.test(failure.signal))) Object.assign(sanitized, { signal: failure.signal });
  }
  return sanitized;
};

export const createGitHubClient = (options: {
  execute?: CommandExecutor;
  now?: () => number;
  timeoutMs?: number;
  maxBufferBytes?: number;
} = {}): GitHubClient => {
  const execute = options.execute === undefined ? executeCommand : options.execute;
  const now = options.now === undefined ? Date.now : options.now;
  const timeoutMs = options.timeoutMs === undefined ? 30_000 : options.timeoutMs;
  const maxBufferBytes = options.maxBufferBytes === undefined ? 16 * 1024 * 1024 : options.maxBufferBytes;
  positiveInteger(timeoutMs, "GitHub request timeout");
  positiveInteger(maxBufferBytes, "GitHub response size limit");
  if (timeoutMs > 2_147_483_647) throw new Error("GitHub request timeout exceeds the supported timer limit.");
  const cooldowns = new Map<string, { error: GitHubApiError; status: number; retryAt: number }>();
  const request = async (host: string, endpoint: string, signal?: AbortSignal): Promise<HttpResponse> => {
    const base = apiBase(host);
    const cooldown = cooldowns.get(base.origin);
    if (cooldown !== undefined) {
      if (now() < cooldown.retryAt) {
        throw new GitHubApiError(`GitHub API requests for ${host} are paused until ${cooldown.retryAt}.`, {
          status: cooldown.status, retryAt: cooldown.retryAt, cause: cooldown.error,
        });
      }
      cooldowns.delete(base.origin);
    }
    const origin = new URL(`https://${host}`);
    const ported = origin.port !== "";
    let target = endpoint;
    if (ported) {
      const url = new URL(endpoint, base);
      if (url.origin !== base.origin || url.username !== "" || url.password !== "" || url.hash !== "" || !url.pathname.startsWith(base.pathname)) {
        throw new GitHubApiError(`Cannot construct a GitHub API URL for ${host}.`);
      }
      target = url.href;
    }
    let credential: string | null = null;
    if (ported && !process.env.GH_ENTERPRISE_TOKEN && !process.env.GITHUB_ENTERPRISE_TOKEN) {
      let authentication: CommandResult;
      try {
        authentication = await execute("gh", ["auth", "token", "--hostname", origin.hostname],
          { timeoutMs, maxBufferBytes, ...(signal === undefined ? {} : { signal }) });
      } catch (cause) {
        throw new GitHubApiError(`Cannot obtain prepared GitHub authentication for ${origin.hostname}.`, { cause: sanitizedProcessError(cause) });
      }
      const token = authentication.stdout.trim();
      if (authentication.error !== null || signal?.aborted || !/^[^\s\0]+$/.test(token)) {
        throw new GitHubApiError(`Cannot obtain prepared GitHub authentication for ${origin.hostname}.`, { cause: sanitizedProcessError(authentication.error) });
      }
      credential = token;
    }
    let result: CommandResult;
    try {
      result = await execute("gh", ["api", "--include", "--method", "GET", "--hostname", ported ? origin.hostname : host,
        "--header", "Accept: application/vnd.github+json", "--header", "X-GitHub-Api-Version: 2022-11-28", target],
      { timeoutMs, maxBufferBytes, ...(signal === undefined ? {} : { signal }), ...(credential === null ? {} : { environment: { GH_ENTERPRISE_TOKEN: credential } }) });
    } catch (cause) {
      throw new GitHubApiError(`GitHub request failed for ${host}/${endpoint}.`, { cause: ported ? sanitizedProcessError(cause) : cause });
    }
    const failure = result.error;
    const publicFailure = !ported || failure === null ? failure : sanitizedProcessError(failure);
    if (signal?.aborted || (failure !== null && (!("code" in failure) || typeof failure.code !== "number" || ("killed" in failure && failure.killed === true) || ("signal" in failure && failure.signal !== null && failure.signal !== undefined)))) {
      throw new GitHubApiError(`GitHub request did not produce complete output for ${host}/${endpoint}.`, {
        cause: failure === null ? (ported ? sanitizedProcessError(signal?.reason) : signal?.reason) : publicFailure,
      });
    }
    let response: HttpResponse;
    try { response = parseResponse(result.stdout); } catch (cause) {
      const publicCause = ported ? sanitizedProcessError(cause) : cause;
      throw new GitHubApiError(`Cannot parse GitHub response for ${host}/${endpoint}.`, {
        cause: publicFailure === null ? publicCause : new AggregateError([publicFailure, publicCause], "GitHub CLI failed and its response was invalid."),
      });
    }
    if (response.status < 200 || response.status >= 300) {
      let retryAt: number | null;
      try { retryAt = rateLimitRetryAt(response, now()); } catch (cause) {
        throw new GitHubApiError(`GitHub HTTP ${response.status} returned invalid retry metadata for ${host}/${endpoint}.`, {
          status: response.status, cause: publicFailure === null ? cause : new AggregateError([publicFailure, cause]),
        });
      }
      const error = new GitHubApiError(`GitHub HTTP ${response.status} for ${host}/${endpoint}.`, {
        status: response.status, retryAt, ...(publicFailure === null ? {} : { cause: publicFailure }),
      });
      if (retryAt !== null) cooldowns.set(base.origin, { error, status: response.status, retryAt });
      throw error;
    }
    if (publicFailure !== null) throw new GitHubApiError(`GitHub CLI exited unsuccessfully after HTTP ${response.status} for ${host}/${endpoint}.`, { cause: publicFailure });
    return response;
  };
  const scan = async <T>(repository: GitHubRepository, state: "all" | "open", project: (item: unknown) => T, signal?: AbortSignal): Promise<T[]> => {
    const base = apiBase(repository.host);
    const first = new URL(`repos/${repository.owner}/${repository.name}/pulls`, base);
    first.search = new URLSearchParams({ state, sort: "created", direction: "asc", per_page: "100", page: "1" }).toString();
    let page: URL | null = first;
    const visited = new Set<string>();
    const results = new Map<number, T>();
    while (page !== null) {
      if (visited.has(page.href)) throw new Error("GitHub pagination repeated a page.");
      visited.add(page.href);
      const response = await request(repository.host, page.pathname.slice(base.pathname.length) + page.search, signal);
      if (!Array.isArray(response.body)) throw new Error("GitHub PR list must be an array.");
      for (const item of response.body) results.set(pullRequestNumber(item), project(item));
      page = nextPage(response, page, repository, first);
    }
    return [...results.values()];
  };
  return {
    resolveRepository: async (configuration, signal) => {
      const response = await request(configuration.host, `repos/${configuration.owner}/${configuration.name}`, signal);
      const data = object(response.body, "GitHub repository");
      return { host: configuration.host, githubId: String(positiveInteger(data.id, "GitHub repository ID")), owner: configuration.owner, name: configuration.name };
    },
    listPullRequestNumbers: (repository, signal) => scan(repository, "all", pullRequestNumber, signal),
    listOpenPullRequests: async (repository, cutoff, signal) => {
      const results = (await scan(repository, "open", (item) => item, signal)).filter((item) => pullRequestNumber(item) > cutoff).map(observation);
      if (results.some((item) => item.state !== "open")) throw new Error("GitHub open PR list contains a closed PR.");
      return results;
    },
    getPullRequest: async (repository, number, signal) => {
      positiveInteger(number, "PR number");
      const response = await request(repository.host, `repos/${repository.owner}/${repository.name}/pulls/${number}`, signal);
      const result = observation(response.body);
      if (result.number !== number) throw new Error("GitHub returned a different PR than requested.");
      return result;
    },
  };
};

export const pollRepository = async (
  store: Store,
  configuration: RepositoryConfiguration,
  client: GitHubClient,
  options: { now: () => number; signal?: AbortSignal },
): Promise<RepositoryState> => {
  let identity: RepositoryIdentity | null = null;
  try {
    const repository = await client.resolveRepository(configuration, options.signal);
    identity = repository;
    const registered = store.registerRepository({ ...repository, remote: configuration.remote, localPath: configuration.path });
    if (registered.startPrNumber === null) {
      const numbers = await client.listPullRequestNumbers(repository, options.signal);
      const startPrNumber = numbers.reduce((maximum, number) => Math.max(maximum, number), 0);
      return store.applyRepositoryPoll(repository, { kind: "initialize", startPrNumber }, options.now());
    }
    const observations = await client.listOpenPullRequests(repository, registered.startPrNumber, options.signal);
    const observed = new Set(observations.map((item) => item.number));
    for (const previous of store.listPullRequests(repository)) {
      if (previous.state === "open" && !observed.has(previous.number)) observations.push(await client.getPullRequest(repository, previous.number, options.signal));
    }
    return store.applyRepositoryPoll(repository, { kind: "snapshot", observations }, options.now());
  } catch (error) {
    if (identity !== null) {
      try { store.recordPollError(identity, error instanceof Error ? error.message : String(error)); } catch (recordError) {
        throw new AggregateError([error, recordError], `GitHub polling and error persistence failed for ${configuration.coordinate}.`);
      }
    }
    throw error;
  }
};

export type RepositoryPollResult =
  | { configuration: RepositoryConfiguration; ok: true; repository: RepositoryState }
  | { configuration: RepositoryConfiguration; ok: false; error: unknown };

export const pollRepositories = async (
  store: Store,
  configurations: readonly RepositoryConfiguration[],
  client: GitHubClient,
  options: { now: () => number; signal?: AbortSignal },
): Promise<RepositoryPollResult[]> => {
  const results: RepositoryPollResult[] = [];
  for (const configuration of configurations) {
    try { results.push({ configuration, ok: true, repository: await pollRepository(store, configuration, client, options) }); }
    catch (error) { results.push({ configuration, ok: false, error }); }
  }
  return results;
};
