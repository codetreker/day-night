import type { PlatformMessages } from "../platform";

export const platform: PlatformMessages = {
  title: "执行平台", any: "不限平台", names: { windows: "Windows", linux: "Linux", macos: "macOS" },
  confirmTitle: "修改执行平台？", confirmQuestion: "确认修改此任务的执行平台？",
  transition: ({ from, to }) => `当前平台：${from}。目标平台：${to}。`,
  explanation: "只有确认后才会修改任务要求。Worker 必须在指定平台运行；不限平台会清除要求。",
  confirm: "修改平台", cancel: "取消", closeConfirmation: "关闭确认框",
  help: "Worker 必须在指定平台运行；不限平台会清除要求。选择选项后审阅并确认修改。",
  locked: "任务正在进行中，保持此状态时无法修改执行平台。",
  pending: "正在保存执行平台。可以关闭详情，结果会保留。",
  confirmed: "执行平台已更新。",
  conflict: "任务已发生变化，请检查当前平台后重新确认修改。",
  unknown: "平台修改结果尚未确认，再次操作前请先核对实际任务。",
  reconciled: "已读取实际任务，当前显示的平台已确认。",
  checking: "正在核对实际任务…", checkState: "核对实际任务",
  checkFailed: "暂时无法确认实际任务，读取成功前无法再次修改。",
  networkError: "平台修改未能从服务取得可确认的响应。",
  protocolError: "服务响应无法确认执行平台。",
  versionConflict: "任务版本已变化，本次修改未能生效。",
  invalidTransition: "任务执行期间无法修改执行平台。",
  notFound: "任务或项目已无法读取。", refused: "服务拒绝了执行平台修改。", requestFailed: "执行平台修改失败。",
};
