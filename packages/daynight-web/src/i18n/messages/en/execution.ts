import type { ExecutionMessages } from "../execution";
import { getFormats } from "../../formats";

export const execution: ExecutionMessages = {
  possiblyStuck: "Possibly stuck",
  description: ({ duration, startedAt, completedAt, warningMinutes, overdue }) =>
    `Execution time: ${duration}; Started: ${startedAt}; ${completedAt === null ? "Running" : `Completed: ${completedAt}`}; Warning threshold: ${getFormats("en").number(warningMinutes)} ${warningMinutes === 1 ? "minute" : "minutes"}.${overdue ? " Possibly stuck." : ""}`,
};
