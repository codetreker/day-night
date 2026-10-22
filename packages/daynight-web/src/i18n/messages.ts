import type { Locale, LocaleIssue } from "./locale";
import { en } from "./messages/en";
import { zhCN } from "./messages/zh-CN";

export type Messages = {
  readonly common: {
    readonly retrySave: string;
  };
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
