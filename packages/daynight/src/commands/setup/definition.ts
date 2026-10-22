import type { CommandDefinition } from "../../cli/schema.js";

export const setupDefinition: CommandDefinition = {
  name: "setup",
  description: "Configure the server connection or review repositories",
  options: [
    { names: ["--server-url"], description: "HTTP(S) server origin", value: { name: "url", kind: "text" } },
    { names: ["--server-token-stdin"], description: "Read one personal access token from piped stdin" },
    { names: ["--review-repo"], description: "HTTPS or SSH GitHub repository address", value: { name: "remote", kind: "text" } },
    { names: ["--review-path"], description: "Dedicated review clone path (requires --review-repo)", value: { name: "path", kind: "directory" } },
    { names: ["-h", "--help"], description: "Show this help", action: "help" },
  ],
  details: "Without options, choose server, review, or both interactively; server tokens use hidden terminal input.\nExplicit options configure only the selected capabilities without prompting.\n--server-token-stdin reads one nonempty line and uses --server-url or the configured server origin.\nChanging the server origin clears its token unless a replacement is supplied.\nReview clone paths default to repositoryRoot (default: ~/daynights).",
};
