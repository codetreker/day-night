import { parseApiJson } from "../../src/api/json.js";
import { parseTask } from "../../src/api/parse.js";
import type { Task } from "../../src/api/types.js";

export const inventoryObservesUniqueTask = (stdout: string, expected: Task): boolean => {
  const decoded = parseApiJson(stdout);
  if (!Array.isArray(decoded)) return false;
  const matches = decoded.map((value) => parseTask(value, expected.projectId)).filter((task) =>
    task.title === expected.title
    && task.description === expected.description
    && JSON.stringify([...task.dependsOn].sort()) === JSON.stringify([...expected.dependsOn].sort())
    && JSON.stringify(task.properties) === JSON.stringify(expected.properties),
  );
  return matches.length === 1 && matches[0]!.id === expected.id;
};
