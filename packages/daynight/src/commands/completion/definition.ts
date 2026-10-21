import type { CommandDefinition } from "../../cli/schema.js";

const help = { names: ["-h", "--help"], description: "Show this help", action: "help" } as const;

export const completionDefinition: CommandDefinition = {
  name: "completion",
  description: "Generate or install shell completion for Bash or zsh",
  commands: [
    { name: "bash", description: "Generate Bash >=4.2 completion", options: [help] },
    { name: "zsh", description: "Generate native zsh completion", options: [help] },
    {
      name: "setup",
      description: "Install completion in shell startup files",
      options: [
        { names: ["--shell"], description: "Select the shell instead of detecting the calling shell", value: { name: "shell", kind: "text", choices: ["bash", "zsh"] } },
        { names: ["--rc-file"], description: "Manage only this startup file", value: { name: "path", kind: "text" } },
        help,
      ],
      details: "Without --shell, detect the calling Bash or zsh process.\nBash setup covers ~/.bashrc and the first existing login profile.\nzsh setup uses $ZDOTDIR/.zshrc, or ~/.zshrc when ZDOTDIR is unset.\nSetup installs startup configuration; activate the current shell with source <(daynight completion bash|zsh).",
    },
  ],
  options: [help],
  details: "Bash >=4.2: source <(daynight completion bash).\nzsh: initialize compinit, then source <(daynight completion zsh).\nRun daynight completion setup to install startup configuration.\nReload the script in existing shells after updating daynight.",
};
