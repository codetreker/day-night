import type { ExecutionMessages } from "../execution";
import { getFormats } from "../../formats";

export const execution: ExecutionMessages = {
  possiblyStuck: "可能卡住了",
  description: ({ duration, startedAt, completedAt, warningMinutes, overdue }) =>
    `执行耗时：${duration}；开始：${startedAt}；${completedAt === null ? "进行中" : `完成：${completedAt}`}；提醒阈值：${getFormats("zh-CN").number(warningMinutes)} 分钟。${overdue ? "可能卡住了。" : ""}`,
};
