import { Document } from "yaml";
import type { CliContext } from "../cli/context.js";
import { SetupCancelledError } from "../cli/prompts.js";
import { parseConfigurationDocument } from "./document.js";
import { MissingConfigurationFileError, isMissingConfiguration } from "./errors.js";
import { readConfigurationSource, updateConfigurationFile } from "./files.js";
import { resolveConfigurationPaths } from "./paths.js";
import { normalizeServerUrl } from "./server.js";
import type { AddRepositoryInput } from "../commands/review/repositories.js";

export type SetupInput = { serverUrl?: string; reviewRepository?: AddRepositoryInput };
type Capability = "server" | "review";

const optionalSource = async (context: CliContext, signal: AbortSignal): Promise<string | undefined> => {
  try { return await readConfigurationSource(resolveConfigurationPaths(context.homeDirectory()), signal); }
  catch (cause) { if (cause instanceof MissingConfigurationFileError) return undefined; throw cause; }
};

const withCancellation = async <Result>(action: (signal: AbortSignal) => Promise<Result>, supplied?: AbortSignal): Promise<Result> => {
  if (supplied !== undefined) return action(supplied);
  const controller = new AbortController();
  const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"];
  const cancel = (): void => controller.abort(new SetupCancelledError());
  for (const signal of signals) process.on(signal, cancel);
  try { return await action(controller.signal); }
  finally { for (const signal of signals) process.off(signal, cancel); }
};

export const configure = async (
  context: CliContext,
  input?: SetupInput,
  capability?: Capability,
  suppliedSignal?: AbortSignal,
): Promise<void> => withCancellation(async (signal) => {
  const paths = resolveConfigurationPaths(context.homeDirectory());
  const source = await optionalSource(context, signal);
  const baseline = source === undefined ? {} : parseConfigurationDocument(source, paths).mapping;
  const ask = async (question: string): Promise<string> => {
    if (context.prompt?.isInteractive !== true) throw new Error("Interactive setup requires terminal input and stderr. Use daynight setup --server-url <url> or daynight setup --review-repo <remote>.");
    signal.throwIfAborted();
    const answer = await context.prompt.ask(question, signal);
    signal.throwIfAborted();
    return answer;
  };
  const retry = async <Value>(question: string, validate: (answer: string) => Value | Promise<Value>): Promise<Value> => {
    for (;;) {
      const answer = await ask(question);
      try { return await validate(answer); }
      catch (cause) {
        signal.throwIfAborted();
        if (cause instanceof SetupCancelledError) throw cause;
        context.stderr(`${cause instanceof Error ? cause.message : String(cause)}\n`);
      }
    }
  };
  try {
    let server = input?.serverUrl !== undefined || capability === "server";
    let review = input?.reviewRepository !== undefined || capability === "review";
    if (input === undefined && capability === undefined) {
      const selected = await retry("Configure (server/review/both): ", (answer) => {
        if (!["server", "review", "both"].includes(answer)) throw new Error("Choose server, review, or both.");
        return answer;
      });
      server = selected !== "review";
      review = selected !== "server";
    }
    let serverUrl = input?.serverUrl;
    if (server && serverUrl === undefined) serverUrl = await retry("Server URL (for example http://127.0.0.1:8787): ", normalizeServerUrl);
    if (serverUrl !== undefined) serverUrl = normalizeServerUrl(serverUrl);
    let reviewRepository = input?.reviewRepository;
    let reviewTools: typeof import("../commands/review/repositories.js") | undefined;
    let reviewPaths: ReturnType<typeof import("../commands/review/paths.js")["resolveReviewPaths"]> | undefined;
    let reviewOptions: { homeDirectory: string; workingDirectory: string } | undefined;
    if (review) {
      const { validateRegistrationConfigurationSource, remoteIdentity } = await import("../commands/review/config.js");
      reviewTools = await import("../commands/review/repositories.js");
      reviewPaths = (await import("../commands/review/paths.js")).resolveReviewPaths(context.homeDirectory());
      reviewOptions = { homeDirectory: context.homeDirectory(), workingDirectory: context.workingDirectory() };
      if (source !== undefined) await validateRegistrationConfigurationSource(source, reviewPaths);
      if (reviewRepository === undefined) {
        const remote = await retry("Review repository (HTTPS or SSH GitHub address): ", (answer) => { remoteIdentity(answer, "remote"); return answer; });
        reviewRepository = await retry("Review clone path (blank for configured default): ", async (answer) => {
          const candidate = answer === "" ? { remote } : { remote, path: answer };
          await reviewTools!.updateRepositoryConfiguration(source, candidate, reviewPaths!, reviewOptions!);
          return candidate;
        });
      }
      await reviewTools.updateRepositoryConfiguration(source, reviewRepository, reviewPaths, reviewOptions);
    }
    const selectedFields = [...(server ? ["serverUrl"] : []), ...(review ? ["repositoryRoot", "repositories"] : [])];
    const fingerprint = (mapping: Record<string, unknown>): string => JSON.stringify(selectedFields.map((field) => [field, Object.hasOwn(mapping, field), mapping[field]]));
    signal.throwIfAborted();
    await updateConfigurationFile(paths, async (currentSource) => {
      const current = currentSource === undefined ? undefined : parseConfigurationDocument(currentSource, paths);
      if (fingerprint(current?.mapping ?? {}) !== fingerprint(baseline)) throw new Error("Configuration changed during setup. Run setup again to review the current values.");
      const document = current?.document ?? new Document({});
      if (serverUrl !== undefined) document.set("serverUrl", serverUrl);
      let updatedSource = document.toString();
      if (reviewRepository !== undefined) {
        const result = await reviewTools!.updateRepositoryConfiguration(updatedSource, reviewRepository, reviewPaths!, reviewOptions!);
        if (result.source !== undefined) updatedSource = result.source;
      }
      return { result: undefined, source: updatedSource };
    }, signal);
    context.stderr(`Configuration saved to ${paths.configFile}.\n`);
  } catch (cause) {
    if (signal.aborted) throw new SetupCancelledError({ cause: signal.reason });
    throw cause;
  } finally { context.prompt?.close(); }
}, suppliedSignal);

export const guideMissingConfiguration = async <Result>(
  context: CliContext,
  capability: Capability,
  load: () => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> => {
  try { return await load(); }
  catch (cause) {
    if (!isMissingConfiguration(cause, capability === "server" ? "serverUrl" : "repositories")) throw cause;
    if (context.prompt?.isInteractive !== true) {
      const command = capability === "server" ? "daynight setup --server-url <url>" : "daynight setup --review-repo <remote>";
      throw new Error(`${cause instanceof Error ? cause.message : String(cause)} Run ${command} to configure it.`, { cause: cause instanceof MissingConfigurationFileError ? cause.cause : cause });
    }
    await configure(context, undefined, capability, signal);
    return load();
  }
};
