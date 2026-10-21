import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { assertCodexNoCredentialFiles, codexPrivateEnvironmentValues, isCodexPrivateEnvironmentName } from "./codex-privacy.js";

let root: string;
beforeEach(async () => {
  const temporary = path.resolve(import.meta.dirname, "../../../../.tmp");
  await mkdir(temporary, { recursive: true });
  root = await mkdtemp(path.join(temporary, "codex-privacy-"));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("keeps public execution policy out of the private environment classifier", () => {
  expect(isCodexPrivateEnvironmentName("DAYNIGHT_NATIVE_CODEX_SANDBOX")).toBe(false);
  for (const name of ["DAYNIGHT_NATIVE_CODEX_AUTH", "DAYNIGHT_NATIVE_CODEX_HEADER_0", "OPENAI_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) expect(isCodexPrivateEnvironmentName(name)).toBe(true);
});

it("allows the public sandbox policy to appear in native state", async () => {
  const credentials = codexPrivateEnvironmentValues({ DAYNIGHT_NATIVE_CODEX_SANDBOX: "danger-full-access" });
  await writeFile(path.join(root, "runtime.json"), JSON.stringify({ sandbox: "danger-full-access" }));
  await expect(assertCodexNoCredentialFiles(root, credentials)).resolves.toBeUndefined();
});

it.each([
  ["command-auth helper token", "fixture-helper-private-value"],
  ["provider header x-openai-actor-authorization", "fixture-header-private-value"],
  ["environment DAYNIGHT_NATIVE_CODEX_AUTH", "fixture-bridge-private-value"],
])("rejects persisted %s and reports only its category and relative file", async (label, value) => {
  await mkdir(path.join(root, "logs"));
  await writeFile(path.join(root, "logs/native.sqlite"), Buffer.from(`prefix\0${value}\0suffix`));
  const credentials = [...codexPrivateEnvironmentValues({ DAYNIGHT_NATIVE_CODEX_SANDBOX: "danger-full-access" }), { label, value }];
  await expect(assertCodexNoCredentialFiles(root, credentials)).rejects.toThrow(`Codex persisted ${label} in isolated state file ${path.join("logs", "native.sqlite")}.`);
  try { await assertCodexNoCredentialFiles(root, credentials); }
  catch (error) { expect(error instanceof Error && error.message.includes(value)).toBe(false); }
});
