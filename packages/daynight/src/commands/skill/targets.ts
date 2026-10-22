import path from "node:path";
import { resolvePhysicalDirectory } from "../../platform/filesystem.js";
import type { SkillAgent } from "./agents.js";

export type SkillScope = "user" | "project";
export type SkillTarget = {
  path: string;
  legacyPath: string;
  parent: string;
  ancestor: string;
  missingParents: readonly string[];
  agents: SkillAgent[];
};

const comparisonPath = (value: string): string => process.platform === "win32" ? value.toLowerCase() : value;
const contains = (parent: string, child: string): boolean => {
  const relative = path.relative(comparisonPath(parent), comparisonPath(child));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export const planSkillTargets = async (base: string, agents: readonly SkillAgent[]): Promise<SkillTarget[]> => {
  const targets: SkillTarget[] = [];
  for (const agent of agents) {
    const parent = await resolvePhysicalDirectory(path.join(base, agent.directory, "skills"));
    const physicalParent = path.join(parent.ancestorPath, ...parent.missingComponents);
    const targetPath = path.join(physicalParent, "using-daynight");
    const existing = targets.find((target) => comparisonPath(target.path) === comparisonPath(targetPath));
    if (existing !== undefined) existing.agents.push(agent);
    else targets.push({ path: targetPath, legacyPath: path.join(physicalParent, "daynight"), parent: physicalParent, ancestor: parent.ancestorPath, missingParents: parent.missingComponents, agents: [agent] });
  }
  for (const [index, first] of targets.entries()) {
    for (const second of targets.slice(index + 1)) {
      if (contains(first.path, second.path) || contains(second.path, first.path)) {
        throw new Error(`Cannot install overlapping skill targets: ${first.agents.map(({ name }) => name).join(", ")} at ${first.path}; ${second.agents.map(({ name }) => name).join(", ")} at ${second.path}. Change the parent skill-directory links so neither target contains the other.`);
      }
    }
  }
  for (const legacy of targets) {
    for (const target of targets) {
      if (comparisonPath(legacy.legacyPath) === comparisonPath(target.path) || contains(legacy.legacyPath, target.path)) {
        throw new Error(`Cannot remove legacy daynight skill at ${legacy.legacyPath}: it contains the using-daynight installation at ${target.path}. Change the parent skill-directory links so legacy cleanup cannot remove a selected installation.`);
      }
    }
  }
  return targets;
};
