import type { TaskStatus } from "../api/types";
import type { WorkspaceMessages } from "./messages/workspace";
import type { GraphMessages } from "./messages/graph";
import type { InspectionMessages } from "./messages/inspection";
import type { Locale, LocaleIssue } from "./locale";
import { en } from "./messages/en";
import { zhCN } from "./messages/zh-CN";

export type Messages = {
  readonly common: {
    readonly retrySave: string;
    readonly status: Readonly<Record<TaskStatus, string>>;
    readonly requestId: string;
  };
  readonly workspace: WorkspaceMessages;
  readonly graph: GraphMessages;
  readonly inspection: InspectionMessages;
  readonly language: {
    readonly label: string;
    readonly options: Readonly<Record<Locale, string>>;
    readonly preferenceNotice: Readonly<Record<LocaleIssue["kind"], string>>;
  };
};

export const messagesByLocale: Readonly<Record<Locale, Messages>> = {
  en,
  "zh-CN": zhCN,
};
