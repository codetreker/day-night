import type { RepositoryConfiguration } from "./config.js";
import type { GitHubClient } from "./adapters/github.js";
import type { RepositoryIdentity, RepositoryState } from "./model.js";
import type { Store } from "./store.js";

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
