import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createInstalledCli } from "../fixtures/installed-cli.js";
import { createSkillFixture, skillTerminal, skillTerminalSessionsClosed } from "../fixtures/skill-terminal.js";

let installed: Awaited<ReturnType<typeof createInstalledCli>>;
let sequence = 0;
beforeAll(async () => { installed = await createInstalledCli(); });
afterAll(async () => { expect(skillTerminalSessionsClosed()).toBe(true); await installed?.cleanup(); });
const fresh = () => createSkillFixture(path.join(installed.receipt.root, `secret terminal ${sequence++}`), []);

it("hides personal access tokens in native terminal input through the installed launcher", async () => {
  const fixture = await fresh();
  const secret = "native-secret-ASCII_~!";
  const result = await skillTerminal(installed.receipt, fixture, [
    { waitFor: "Configure (server/review/both): ", keys: ["server\r"] },
    { waitFor: "Server URL (for example http://127.0.0.1:8787): ", keys: ["https://service.example\r"] },
    { waitFor: "Server token (hidden; blank to skip):", keys: [secret, "\r"] },
  ], fixture.home, { launcherPath: installed.receipt.launcherPath, args: ["setup"] });
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain(secret);
  expect(result.stderr).not.toMatch(/\u001b\[\d+G[^\u001b\r\n]/);
  expect(parse(await readFile(path.join(fixture.home, ".daynight/config.yml"), "utf8"))).toEqual({ serverUrl: "https://service.example", serverToken: secret });
});

it.each(["\u0003", "\u0004"])("cancels hidden native terminal input and preserves the original configuration (%j)", async (key) => {
  const fixture = await fresh();
  const directory = path.join(fixture.home, ".daynight");
  await mkdir(directory);
  const original = "serverUrl: https://service.example\nserverToken: previous-secret\n";
  const configuration = path.join(directory, "config.yml");
  await writeFile(configuration, original);
  const secret = "cancelled-input";
  const result = await skillTerminal(installed.receipt, fixture, [
    { waitFor: "Configure (server/review/both): ", keys: ["server\r"] },
    { waitFor: "Server URL (for example http://127.0.0.1:8787): ", keys: ["https://service.example\r"] },
    { waitFor: "Server token (hidden; blank to keep current token):", keys: [secret, key] },
  ], fixture.home, { launcherPath: installed.receipt.launcherPath, args: ["setup"] });
  expect(result.code, result.stderr).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Setup cancelled.");
  expect(result.stderr).not.toContain(secret);
  expect(result.stderr).not.toMatch(/\u001b\[\d+G[^\u001b\r\n]/);
  expect(await readFile(configuration, "utf8")).toBe(original);
  expect(await readdir(directory)).toEqual(["config.yml"]);
});
