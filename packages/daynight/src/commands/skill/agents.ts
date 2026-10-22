import which from "which";

export const skillAgents = [
  { id: "codex", name: "Codex", command: "codex", directory: ".agents", reload: "Codex discovers skills automatically; restart the session if it is not listed." },
  { id: "copilot", name: "Copilot CLI", command: "copilot", directory: ".agents", reload: "In Copilot CLI, run /skills reload and /skills info using-daynight." },
  { id: "claude", name: "Claude Code", command: "claude", directory: ".claude", reload: "Claude Code discovers existing skill directories automatically; run /reload-skills after creating a new top-level directory." },
] as const;

export type SkillAgent = typeof skillAgents[number];
export type SkillAgentId = SkillAgent["id"];
export type AgentLookup = (command: string) => Promise<string | null>;

export const detectSkillAgents = async (
  lookup: AgentLookup = async (command) => which(command, { nothrow: true }),
): Promise<SkillAgent[]> => {
  const detected: SkillAgent[] = [];
  for (const agent of skillAgents) if (await lookup(agent.command) !== null) detected.push(agent);
  return detected;
};
