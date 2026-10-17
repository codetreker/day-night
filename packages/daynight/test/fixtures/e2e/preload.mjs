import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const directory = process.env.DAYNIGHT_E2E_DIRECTORY;
const record = (kind, data) => {
  const folder = path.join(directory, kind);
  mkdirSync(folder, { recursive: true });
  const identity = randomUUID();
  const pending = path.join(folder, `${identity}.pending`);
  writeFileSync(pending, JSON.stringify(data), { flag: "wx" });
  renameSync(pending, path.join(folder, `${identity}.json`));
};
const records = (kind) => {
  const folder = path.join(directory, kind);
  return existsSync(folder) ? readdirSync(folder).filter((file) => file.endsWith(".json")).map((file) => JSON.parse(readFileSync(path.join(folder, file), "utf8"))) : [];
};

// A renamed native Node executable keeps execFile("gh") real on Windows.
// Preloading runs before Node resolves the intentionally absent "api" entrypoint.
if (/^gh(?:\.exe)?$/i.test(path.basename(process.execPath))) {
  const args = [path.basename(process.argv[1]), ...process.argv.slice(2)];
  if (args[0] !== "api") throw new Error(`Unexpected fake gh command: ${JSON.stringify(args)}`);
  const methodIndex = args.indexOf("--method");
  const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
  const endpoint = args.find((argument) => argument.startsWith("repos/"));
  if (endpoint === undefined) throw new Error("The fake gh only accepts fixture repository API endpoints.");
  const url = new URL(endpoint, "https://fixture.invalid/");
  const state = JSON.parse(readFileSync(path.join(directory, "api.json"), "utf8"));
  const match = /^\/repos\/fixture\/review-project(?:\/pulls(?:\/(\d+)(\/reviews)?)?)?$/.exec(url.pathname);
  if (match === null) throw new Error(`Unexpected fake API endpoint: ${endpoint}`);
  let result;
  if (method === "POST") {
    if (process.env.DAYNIGHT_E2E_PUBLISHER !== "copilot-fixture") throw new Error("Only the controlled Copilot agent may publish reviews.");
    if (match[2] !== "/reviews" || args[args.indexOf("--input") + 1] !== "-") throw new Error("Unexpected publication.");
    const publication = JSON.parse(readFileSync(0, "utf8"));
    if (!["COMMENT", "APPROVE"].includes(publication.event)) throw new Error("Only COMMENT and APPROVE are permitted.");
    const pr = state.pulls.find((item) => item.number === Number(match[1]));
    if (pr.state !== "open" || pr.draft || publication.commit_id !== pr.head.sha) throw new Error("Publication target is stale.");
    result = { id: randomUUID(), number: pr.number, publisher: process.env.DAYNIGHT_E2E_PUBLISHER, ...publication };
    record("publications", result);
  } else if (method === "GET") {
    if (match[2] === "/reviews") result = records("publications").filter((item) => item.number === Number(match[1]));
    else if (match[1] !== undefined) result = state.pulls.find((item) => item.number === Number(match[1]));
    else if (url.pathname.endsWith("/pulls")) result = state.pulls.filter((item) => url.searchParams.get("state") !== "open" || item.state === "open");
    else result = { id: 4242 };
    record("requests", { version: state.version, endpoint, method });
  } else throw new Error(`Unexpected API method: ${method}`);
  if (result === undefined) throw new Error("The fixture PR does not exist.");
  const output = `${args.includes("--include") ? "HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n" : ""}${JSON.stringify(result)}\n`;
  writeFileSync(1, output);
  process.exit(0);
} else if (directory !== undefined && path.basename(process.argv[1] ?? "") === "main.js") {
  const timer = setInterval(() => {
    if (existsSync(path.join(directory, "crash"))) {
      // This pre-review crash point isolates stale-lock recovery from tool termination.
      const resources = process.getActiveResourcesInfo();
      if (resources.includes("ProcessWrap")) return;
      clearInterval(timer);
      writeFileSync(path.join(directory, "crash-receipt.json"), JSON.stringify({ pid: process.pid, exitCode: 73, resources }), { flag: "wx" });
      process.exit(73);
    }
    if (existsSync(path.join(directory, "stop"))) {
      clearInterval(timer);
      process.emit("SIGINT");
    }
  }, 50);
  timer.unref();
}
