import type { CommandDefinition } from "../../cli/schema.js";

export const completionDefinition: CommandDefinition = {
  name: "completion",
  description: "Generate shell completion for Bash or zsh",
  arguments: [{ name: "shell", description: "Shell to generate completion for (bash or zsh)", choices: ["bash", "zsh"] }],
  options: [{ names: ["-h", "--help"], description: "Show this help", action: "help" }],
  details: "Bash >=4.2: add source <(daynight completion bash) to ~/.bashrc.\nzsh: add source <(daynight completion zsh) after compinit in ~/.zshrc.\nReload the script in existing shells after updating daynight.",
};
