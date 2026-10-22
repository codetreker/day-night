import type { Messages } from "../messages";

export const en: Messages = {
  common: {
    retrySave: "Retry saving language",
  },
  language: {
    label: "语言 / Language",
    options: { en: "English", "zh-CN": "简体中文" },
    preferenceNotice: {
      read: "The saved language could not be read. Browser language is used; switching languages still works for this visit.",
      invalid: "The saved language is invalid. Browser language is used; choose a language to save a new preference.",
      write: "The language could not be saved. Your choice applies now, but may not return after a reload.",
    },
  },
};
