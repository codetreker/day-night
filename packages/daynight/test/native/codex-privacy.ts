import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type CodexPrivateValue = { readonly label: string; readonly value: string };

export const isCodexPrivateEnvironmentName = (name: string): boolean =>
  /(?:TOKEN|SECRET|PASSWORD|API_?KEY|AUTHORIZATION|CREDENTIAL|^ANTHROPIC_AUTH|^DAYNIGHT_NATIVE_CODEX_(?:AUTH$|HEADER_))/i.test(name);

export const codexPrivateEnvironmentValues = (environment: NodeJS.ProcessEnv): CodexPrivateValue[] =>
  Object.entries(environment).flatMap(([name, value]) => isCodexPrivateEnvironmentName(name) && value !== undefined ? [{ label: `environment ${name}`, value }] : []);

export const assertCodexNoCredentialFiles = async (directory: string, credentials: readonly CodexPrivateValue[]): Promise<void> => {
  const needles = credentials.filter(({ value }) => value.length >= 8).map(({ label, value }) => ({ label, bytes: Buffer.from(value) }));
  const visit = async (parent: string): Promise<void> => {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const filename = path.join(parent, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile()) {
        const contents = await readFile(filename);
        const matched = needles.find(({ bytes }) => contents.includes(bytes));
        if (matched !== undefined) throw new Error(`Codex persisted ${matched.label} in isolated state file ${path.relative(directory, filename)}.`);
      }
    }
  };
  await visit(directory);
};
