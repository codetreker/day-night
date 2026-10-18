import { execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import crossSpawn from "cross-spawn";
import { parse, parseDocument } from "yaml";
import { expect, it } from "vitest";

const workspace = path.resolve(import.meta.dirname, "../../..");
const packageDirectory = path.join(workspace, "packages/daynight");
const helpers = path.join(import.meta.dirname, "fixtures/e2e");
type Pull = { number: number; state: "open" | "closed"; draft: boolean; merged_at: string | null; head: { sha: string }; base: { ref: string; sha: string }; ci: "PENDING" | "FAILURE" | "SUCCESS" | null };
type Agent = { session: string; args: string[]; target: { pullRequest: number; reviewId: string; revision: number; headSha: string; baseBranch: string }; head: string; cwd: string; reconciled: boolean; reviewFile: string; prompt: string };
type Publication = { number: number; event: string; commit_id: string; body: string; publisher: string; comments?: unknown[] };
type Request = { version: number; endpoint: string; method: string };
type PullRow = { desired_revision: number; completed_revision: number; session_id: string; cleanup_pending: number; worktree_path: string | null; state: string };

it("runs the packed and installed CLI through a persistent native Git and SQLite review lifecycle", async () => {
  const temporary = path.join(workspace, ".tmp");
  mkdirSync(temporary, { recursive: true });
  rmSync(path.join(temporary, "e2e-evidence.json"), { force: true });
  const directory = mkdtempSync(path.join(temporary, "Installed CLI 中文 "));
  try {
    const home = path.join(directory, "home 中文");
    const stateDirectory = path.join(home, ".daynight");
    const bin = path.join(directory, "executables");
    const consumer = path.join(directory, "consumer install");
    const repository = path.join(directory, "review repository 中文");
    const origin = path.join(directory, "origin.git");
    const secondCwd = path.join(directory, "different cwd 中文");
    for (const location of [stateDirectory, bin, consumer, secondCwd]) mkdirSync(location, { recursive: true });
    const fakeGh = path.join(bin, process.platform === "win32" ? "gh.exe" : "gh");
    copyFileSync(process.execPath, fakeGh);
    chmodSync(fakeGh, 0o755);
    const nodeOptions = `--import=${pathToFileURL(path.join(helpers, "preload.mjs")).href}`;
    const environment: NodeJS.ProcessEnv = { ...process.env };
    for (const name of Object.keys(environment)) {
      if (/^(?:GH_|GITHUB_|COPILOT_|GIT_|NODE_OPTIONS$|DAYNIGHT_)/i.test(name)) delete environment[name];
    }
    Object.assign(environment, {
      HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, "config"),
      PATH: `${bin}${path.delimiter}${process.env.PATH}`, NODE_OPTIONS: nodeOptions,
      DAYNIGHT_E2E_DIRECTORY: directory, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(directory, "gitconfig"),
      GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1", GH_PROMPT_DISABLED: "1",
    });
    const git = (args: readonly string[], input?: string): string => execFileSync("git", [...args], {
      cwd: directory, env: environment, encoding: "utf8", timeout: 30_000, ...(input === undefined ? {} : { input }),
    }).trim();
    git(["init", "--bare", "--initial-branch=main", origin]);
    git(["config", "--file", environment.GIT_CONFIG_GLOBAL!, "protocol.allow", "never"]);
    git(["config", "--file", environment.GIT_CONFIG_GLOBAL!, "protocol.file.allow", "always"]);
    git(["config", "--file", environment.GIT_CONFIG_GLOBAL!, `url.${pathToFileURL(origin).href}.insteadOf`, "https://github.com/fixture/review-project.git"]);
    const commit = (contents: string, parent?: string): string => {
      const blob = git(["--git-dir", origin, "hash-object", "-w", "--stdin"], contents);
      const tree = git(["--git-dir", origin, "mktree"], `100644 blob ${blob}\treview.txt\n`);
      return git(["--git-dir", origin, "hash-object", "-t", "commit", "-w", "--stdin"],
        `tree ${tree}\n${parent === undefined ? "" : `parent ${parent}\n`}author Fixture <fixture@example.invalid> 1700000000 +0000\ncommitter Fixture <fixture@example.invalid> 1700000000 +0000\n\n${contents}\n`);
    };
    const base = commit("base\n");
    const first = commit("first review\n", base);
    const second = commit("second review\n", first);
    const third = commit("third review\n", second);
    const updatedBase = commit("base advanced\n", base);
    git(["--git-dir", origin, "update-ref", "refs/heads/main", base]);
    git(["--git-dir", origin, "update-ref", "refs/heads/release", base]);
    git(["--git-dir", origin, "update-ref", "refs/pull/11/head", first]);
    git(["--git-dir", origin, "update-ref", "refs/pull/12/head", third]);
    const pull = (number: number, sha: string, draft = false): Pull => ({ number, state: "open", draft, merged_at: null, head: { sha }, base: { ref: "main", sha: base }, ci: null });
    const old = pull(10, first);
    const current = pull(11, first, true);
    const pulls = [old];
    let version = 0;
    const publishState = (): number => {
      const next = path.join(directory, `${randomUUID()}.json`);
      writeFileSync(next, JSON.stringify({ version: ++version, pulls }));
      renameSync(next, path.join(directory, "api.json"));
      return version;
    };
    publishState();
    const readRecords = <T>(kind: string): T[] => {
      const folder = path.join(directory, kind);
      return existsSync(folder) ? readdirSync(folder).filter((file) => file.endsWith(".json")).map((file) => JSON.parse(readFileSync(path.join(folder, file), "utf8")) as T) : [];
    };
    const agents = () => readRecords<Agent>("agents");
    const publications = () => readRecords<Publication>("publications");
    const databaseFile = path.join(stateDirectory, "state.sqlite");
    const query = <T>(sql: string): T | undefined => {
      if (!existsSync(databaseFile)) return undefined;
      const database = new Database(databaseFile, { readonly: true });
      try {
        if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'repositories'").get() === undefined) return undefined;
        return database.prepare(sql).get() as T | undefined;
      } finally { database.close(); }
    };
    const pr = (number = 11) => query<PullRow>(`SELECT * FROM pull_requests WHERE number = ${number}`);
    let running: ChildProcess | undefined;
    let completion: Promise<number | null> | undefined;
    let output = "";
    let failure: unknown;
    const waitFor = async (condition: () => boolean, description: string, timeout = 90_000): Promise<void> => {
      const deadline = Date.now() + timeout;
      while (!condition()) {
        if (failure !== undefined) throw failure;
        if (running !== undefined && running.exitCode !== null) throw new Error(`Installed CLI exited during ${description}: ${output}`);
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}. CLI output:\n${output}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    const pnpm = (args: string[], cwd: string): void => {
      const result = crossSpawn.sync("pnpm", args, { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", XDG_CACHE_HOME: path.join(temporary, "cache") }, timeout: 120_000 });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`pnpm ${args[0]} failed:\n${result.stdout}\n${result.stderr}`);
    };
    const tarball = path.join(directory, "daynight.tgz");
    const modules = parse(readFileSync(path.join(workspace, "node_modules/.modules.yaml"), "utf8")) as { storeDir: string };
    const storeDirectory = path.dirname(modules.storeDir);
    pnpm(["pack", "--out", tarball], packageDirectory);
    writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ name: "daynight-installed-acceptance", private: true, dependencies: { "@codetreker/daynight": `file:${tarball.replaceAll("\\", "/")}` } }));
    pnpm(["install", "--prod", "--ignore-scripts", "--ignore-workspace", "--no-frozen-lockfile", "--store-dir", storeDirectory, "--reporter", "append-only"], consumer);
    const installedBin = path.join(consumer, "node_modules/.bin", process.platform === "win32" ? "daynight.cmd" : "daynight");
    expect(existsSync(installedBin)).toBe(true);
    const installed = JSON.parse(readFileSync(path.join(consumer, "node_modules", "@codetreker", "daynight", "package.json"), "utf8")) as { name: string; version: string };
    expect(installed.name).toBe("@codetreker/daynight");
    const register = (args: string[], registrationHome = home): void => {
      const result = crossSpawn.sync(installedBin, ["add-repo", ...args], {
        cwd: directory, env: { ...environment, HOME: registrationHome, USERPROFILE: registrationHome, XDG_CONFIG_HOME: path.join(registrationHome, "config") },
        encoding: "utf8", windowsHide: true, timeout: 30_000,
      });
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(0);
    };
    const configFile = path.join(stateDirectory, "config.yml");
    register(["https://github.com/fixture/review-project.git", "--path", path.relative(directory, repository)]);
    expect(parse(readFileSync(configFile, "utf8"))).toMatchObject({
      repositoryRoot: "~/daynights",
      repositories: [{ remote: "https://github.com/fixture/review-project.git", path: repository }],
    });
    expect(readdirSync(stateDirectory)).toEqual(["config.yml"]);
    expect(existsSync(repository)).toBe(false);
    expect(readRecords<Request>("requests")).toHaveLength(0);
    expect(agents()).toHaveLength(0);
    expect(publications()).toHaveLength(0);
    const registrationHome = path.join(directory, "registration home 中文");
    const registrationState = path.join(registrationHome, ".daynight");
    const registrationConfigFile = path.join(registrationState, "config.yml");
    const defaultRepository = path.join(registrationHome, "daynights/github.com/fixture/default-project");
    register(["https://github.com/fixture/default-project.git"], registrationHome);
    const registrationConfig = parseDocument(readFileSync(registrationConfigFile, "utf8"));
    expect(registrationConfig.toJS()).toMatchObject({
      repositoryRoot: "~/daynights",
      repositories: [{ remote: "https://github.com/fixture/default-project.git", path: defaultRepository }],
    });
    const changedRoot = path.join(registrationHome, "future repositories 中文");
    registrationConfig.set("repositoryRoot", changedRoot);
    writeFileSync(registrationConfigFile, registrationConfig.toString());
    register(["https://github.com/fixture/future-project.git"], registrationHome);
    expect(parse(readFileSync(registrationConfigFile, "utf8"))).toMatchObject({
      repositoryRoot: changedRoot,
      repositories: [
        { remote: "https://github.com/fixture/default-project.git", path: defaultRepository },
        { remote: "https://github.com/fixture/future-project.git", path: path.join(changedRoot, "github.com/fixture/future-project") },
      ],
    });
    expect(readdirSync(registrationState)).toEqual(["config.yml"]);
    expect(existsSync(path.join(registrationHome, "daynights"))).toBe(false);
    expect(existsSync(changedRoot)).toBe(false);
    expect(readRecords<Request>("requests")).toHaveLength(0);
    expect(agents()).toHaveLength(0);
    expect(publications()).toHaveLength(0);
    const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
    if (process.platform === "win32") writeFileSync(path.join(bin, "copilot.cmd"), `@"${process.execPath}" "${path.join(helpers, "copilot.mjs")}" %*\r\n`);
    else {
      writeFileSync(path.join(bin, "copilot"), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(helpers, "copilot.mjs"))} "$@"\n`);
      chmodSync(path.join(bin, "copilot"), 0o755);
    }
    const lifecycleConfig = parseDocument(readFileSync(configFile, "utf8"));
    for (const [key, value] of Object.entries({ pollIntervalMs: 200, maxConcurrentWorker: 1, agentTimeoutMs: 60000, maxAttempts: 3, retryDelayMs: 100 })) lifecycleConfig.set(key, value);
    writeFileSync(configFile, lifecycleConfig.toString());
    const start = (cwd: string): void => {
      rmSync(path.join(directory, "stop"), { force: true });
      rmSync(path.join(directory, "crash"), { force: true });
      output = ""; failure = undefined;
      running = crossSpawn(installedBin, ["--daemon-review"], { cwd, env: environment, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      running.stdout!.on("data", (data: Buffer) => { output += data.toString(); });
      running.stderr!.on("data", (data: Buffer) => { output += data.toString(); });
      running.on("error", (error) => { failure = error; });
      completion = new Promise((resolve) => running!.once("close", resolve));
    };
    const awaitClose = async (description: string, timeout = 30_000): Promise<number | null> => {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([completion!, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Installed CLI did not ${description}:\n${output}`)), timeout);
        })]);
      } finally { clearTimeout(timer); }
    };
    const forceStopOwnedTree = async (): Promise<void> => {
      if (running?.pid === undefined) throw new Error("No owned CLI process tree is available to stop.");
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(running.pid), "/T", "/F"], { env: environment, timeout: 30_000, stdio: "pipe" });
      else process.kill(-running.pid, "SIGKILL");
      await awaitClose("close after its owned process tree was forcibly stopped");
      running = undefined;
    };
    const abruptStopWhenQuiescent = async (): Promise<void> => {
      const lock = JSON.parse(readFileSync(path.join(stateDirectory, "instance.lock"), "utf8")) as { pid: number };
      writeFileSync(path.join(directory, "crash"), "exit after direct children have closed\n");
      const code = await awaitClose("exit abruptly after its direct child processes closed");
      running = undefined;
      rmSync(path.join(directory, "crash"));
      expect(code, output).toBe(73);
      const receipt = JSON.parse(readFileSync(path.join(directory, "crash-receipt.json"), "utf8")) as { pid: number; exitCode: number; resources: string[] };
      expect(receipt.pid).toBe(lock.pid);
      expect(receipt.exitCode).toBe(73);
      expect(receipt.resources).not.toContain("ProcessWrap");
    };
    const refusedStartup = (description: string): void => {
      const result = crossSpawn.sync(installedBin, ["--daemon-review"], { cwd: secondCwd, env: environment, encoding: "utf8", windowsHide: true, timeout: 30_000 });
      if (result.error) throw result.error;
      expect(result.status, description).toBe(1);
      expect(result.stderr).toContain("Cannot acquire instance lock");
      expect(result.stderr).toContain("is still running");
    };
    const stop = async (): Promise<void> => {
      writeFileSync(path.join(directory, "stop"), "stop\n");
      const code = await awaitClose("stop cleanly");
      expect(code, output).toBe(0);
      running = undefined;
      expect(existsSync(path.join(stateDirectory, "instance.lock"))).toBe(false);
    };
    const observedWithoutReview = async (stateVersion: number, expectedAgents: number): Promise<void> => {
      await waitFor(() => readRecords<Request>("requests").filter((item) => item.version === stateVersion && item.endpoint.includes("state=open")).length >= 2, `two complete polls for fixture version ${stateVersion}`);
      expect(agents()).toHaveLength(expectedAgents);
    };
    const completed = async (revision: number, number = 11): Promise<void> => {
      await waitFor(() => pr(number)?.completed_revision === revision, `PR ${number} completed revision ${revision}`);
      expect(pr(number)?.desired_revision).toBe(revision);
    };
    const scenarios: string[] = ["config-only-registration", "relative-registration-path", "default-root-registration", "registration-path-fixed-after-root-change"];
    try {
      execFileSync(process.execPath, ["--input-type=module", "--eval", `
        import assert from "node:assert/strict";
        import { spawn } from "node:child_process";
        import { once } from "node:events";
        const child = spawn(process.execPath, ["--eval", "process.stdin.resume()"], { stdio: ["pipe", "ignore", "ignore"] });
        await once(child, "spawn");
        assert(process.getActiveResourcesInfo().includes("ProcessWrap"));
        const closed = once(child, "close");
        child.stdin.end();
        await closed;
        do { await new Promise(setImmediate); } while (process.getActiveResourcesInfo().includes("ProcessWrap"));
        assert(!process.getActiveResourcesInfo().includes("ProcessWrap"));
      `], { env: environment, timeout: 5_000, stdio: "pipe" });
      // The native fake must run its preload before resolving the absent API main.
      expect(JSON.parse(execFileSync(fakeGh, ["api", "repos/fixture/review-project"], { env: environment, encoding: "utf8" }))).toEqual({ id: 4242 });
      start(directory);
      await waitFor(() => query<{ start_pr_no: number }>("SELECT start_pr_no FROM repositories")?.start_pr_no === 10, "permanent initial cutoff");
      expect(git(["-C", repository, "config", "--local", "--get", "remote.origin.url"])).toBe("https://github.com/fixture/review-project.git");
      refusedStartup("a second installed CLI must refuse the active instance lock");
      expect(agents()).toHaveLength(0);
      await abruptStopWhenQuiescent();
      const lockFile = path.join(stateDirectory, "instance.lock");
      expect(existsSync(lockFile)).toBe(true);
      const staleOwner = JSON.parse(readFileSync(lockFile, "utf8")) as { owner: string };
      expect(agents()).toHaveLength(0);
      const recoveredVersion = publishState();
      start(secondCwd);
      await observedWithoutReview(recoveredVersion, 0);
      expect(JSON.parse(readFileSync(lockFile, "utf8")).owner).not.toBe(staleOwner.owner);
      expect(query<{ start_pr_no: number }>("SELECT start_pr_no FROM repositories")?.start_pr_no).toBe(10);
      scenarios.push("singleton-refusal", "abrupt-stop-retains-lock", "automatic-stale-lock-recovery", "restart-preserves-initial-cutoff");
      pulls.push(current);
      await observedWithoutReview(publishState(), 0);
      current.head.sha = second;
      git(["--git-dir", origin, "update-ref", "refs/pull/11/head", second]);
      await observedWithoutReview(publishState(), 0);
      scenarios.push("initial-cutoff", "draft-and-draft-head-skip");
      current.draft = false; current.ci = "PENDING";
      const pendingCiVersion = publishState();
      await observedWithoutReview(pendingCiVersion, 0);
      await waitFor(() => readRecords<Request>("requests").filter((item) => item.version === pendingCiVersion && item.endpoint === "graphql").length >= 2, "pending CI checks");
      expect(query<{ count: number }>("SELECT count(*) AS count FROM reviews")?.count).toBe(0);
      expect(pr()?.session_id).toBeNull();
      expect(pr()?.worktree_path).toBeNull();
      current.ci = "FAILURE";
      const failedCiVersion = publishState();
      await observedWithoutReview(failedCiVersion, 0);
      await waitFor(() => readRecords<Request>("requests").filter((item) => item.version === failedCiVersion && item.endpoint === "graphql").length >= 2, "failed CI checks");
      expect(query<{ count: number }>("SELECT count(*) AS count FROM reviews")?.count).toBe(0);
      current.ci = "SUCCESS"; publishState();
      await completed(3);
      scenarios.push("pending-ci-waits", "failed-ci-waits", "passing-ci-admits");
      const initialAgents = agents();
      expect(initialAgents).toHaveLength(2);
      expect(initialAgents.filter((item) => item.reconciled)).toHaveLength(1);
      expect(initialAgents.map((item) => item.session)).toEqual([initialAgents[0]!.session, initialAgents[0]!.session]);
      expect(initialAgents.flatMap((item) => item.args).filter((argument) => argument.startsWith("--session-id="))).toHaveLength(1);
      expect(initialAgents.flatMap((item) => item.args).filter((argument) => argument.startsWith("--resume="))).toHaveLength(1);
      expect(publications()).toHaveLength(1);
      expect(publications()[0]).toMatchObject({ number: 11, event: "COMMENT", commit_id: second });
      expect(publications()[0]!.comments).toHaveLength(1);
      scenarios.push("ready-review", "inline-comment", "missing-marker-session-reconciliation");
      const session = pr()!.session_id;
      current.head.sha = third; current.ci = "PENDING";
      git(["--git-dir", origin, "update-ref", "refs/pull/11/head", third]);
      await observedWithoutReview(publishState(), 2);
      current.ci = "SUCCESS"; publishState();
      await completed(4);
      scenarios.push("new-head-ci-waits");
      expect(publications().filter((item) => item.event === "APPROVE")).toHaveLength(1);
      scenarios.push("new-head-approval");
      git(["--git-dir", origin, "update-ref", "refs/heads/main", updatedBase]);
      current.base.sha = updatedBase;
      await observedWithoutReview(publishState(), 3);
      current.base = { ref: "release", sha: base }; publishState();
      await completed(5);
      scenarios.push("base-tip-does-not-trigger", "base-branch-triggers");
      await stop();
      expect(pr()!.session_id).toBe(session);
      old.draft = false; old.head.sha = third;
      current.head.sha = second;
      git(["--git-dir", origin, "update-ref", "refs/pull/11/head", second]); publishState();
      start(secondCwd);
      await completed(6);
      expect(query<{ start_pr_no: number }>("SELECT start_pr_no FROM repositories")?.start_pr_no).toBe(10);
      expect(pr()!.session_id).toBe(session);
      expect(query("SELECT * FROM pull_requests WHERE number = 10")).toBeUndefined();
      expect(agents().filter((item) => item.target.pullRequest === 11).every((item) => item.session === session)).toBe(true);
      scenarios.push("orderly-stop-lock-release", "different-cwd-restart", "persistent-cutoff-and-session", "force-push-review");
      const additional = pull(12, third); pulls.push(additional); publishState();
      await completed(1, 12);
      scenarios.push("no-ci-review");
      expect(pr(12)!.session_id).not.toBe(session);
      current.state = "closed"; current.merged_at = "2026-01-01T00:00:00Z";
      additional.state = "closed"; publishState();
      await waitFor(() => pr()!.worktree_path === null && pr(12)!.worktree_path === null, "merged and closed worktree cleanup");
      expect(existsSync(path.join(repository, ".worktrees/pr-11"))).toBe(false);
      expect(existsSync(path.join(repository, ".worktrees/pr-12"))).toBe(false);
      expect(git(["-C", repository, "worktree", "list", "--porcelain"])).not.toContain("pr-11");
      expect(git(["-C", repository, "worktree", "list", "--porcelain"])).not.toContain("pr-12");
      const administrativeWorktrees = path.join(repository, ".git/worktrees");
      expect(existsSync(administrativeWorktrees) ? readdirSync(administrativeWorktrees) : []).toEqual([]);
      expect(pr()!.state).toBe("merged");
      expect(pr(12)!.state).toBe("closed");
      expect(existsSync(path.join(stateDirectory, "copilot/session-state", session))).toBe(true);
      scenarios.push("separate-pr-session", "merged-cleanup", "closed-unmerged-cleanup", "history-retained");
      await stop();
      const calls = agents();
      expect(calls.every((item) => item.head === item.target.headSha && item.cwd === path.join(repository, ".worktrees", `pr-${item.target.pullRequest}`))).toBe(true);
      expect(calls.every((item) => item.prompt.includes("Never submit REQUEST_CHANGES") && item.reviewFile.endsWith("\n"))).toBe(true);
      expect(publications().every((item) => item.publisher === "copilot-fixture" && (item.event === "COMMENT" || item.event === "APPROVE"))).toBe(true);
      writeFileSync(path.join(temporary, "e2e-evidence.json"), JSON.stringify({ success: true, packageVersion: installed.version,
        installedBin: path.relative(directory, installedBin).replaceAll("\\", "/"), packagePacked: true, consumerInstall: "registry",
        sqlite: "real", git: "real-local-origin", github: "controlled-native-executable", copilot: "controlled-default-command-shim",
        liveCopilotExercised: false, liveGitHubExercised: false, scenarios,
        receipts: { agentInvocations: calls.length, publications: publications().length, commentReviews: publications().filter((item) => item.event === "COMMENT").length,
          approvingReviews: publications().filter((item) => item.event === "APPROVE").length, sameSessionAfterRestart: true, cleanShutdowns: 2, cleanedWorktrees: 2,
          singletonRefusals: 1, abruptStops: 1, automaticStaleLockRecoveries: 1 },
      }, null, 2));
    } finally {
      if (running !== undefined) {
        writeFileSync(path.join(directory, "stop"), "stop\n");
        try { await awaitClose("stop during fixture cleanup", 10_000); running = undefined; }
        catch { await forceStopOwnedTree(); }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 180_000);
