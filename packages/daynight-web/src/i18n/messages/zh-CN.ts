import type { Messages } from "../messages";

export const zhCN: Messages = {
  common: {
    retrySave: "重试保存语言",
  },
  language: {
    label: "语言 / Language",
    options: { en: "English", "zh-CN": "简体中文" },
    preferenceNotice: {
      read: "无法读取浏览器保存的语言，已按浏览器语言显示，本次浏览仍可正常切换语言。",
      invalid: "浏览器保存的语言无效，已按浏览器语言显示；重新选择语言可保存新的偏好。",
      write: "语言无法保存到浏览器，本次选择已生效，刷新后可能无法恢复。",
    },
  },
};
