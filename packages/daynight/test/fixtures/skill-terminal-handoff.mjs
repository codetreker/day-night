import { pathToFileURL } from "node:url";

const { createTerminalPrompt } = await import(pathToFileURL(process.argv[2]).href);
const prompt = createTerminalPrompt();
const controller = new AbortController();
try {
  const first = await prompt.ask("First input: ", controller.signal);
  const choice = await prompt.select({
    message: "Choose a value?",
    choices: [{ name: "One", value: "one" }, { name: "Two", value: "two" }],
    default: "one",
  }, controller.signal);
  const last = await prompt.ask("Last input: ", controller.signal);
  process.stdout.write(`${JSON.stringify({ first, choice, last })}\n`);
} finally { prompt.close(); }
