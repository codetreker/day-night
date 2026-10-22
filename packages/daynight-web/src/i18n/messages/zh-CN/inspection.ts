import type { InspectionMessages } from "../inspection";

export const inspection: InspectionMessages = {
  detail: {
    overview: "概览",
    title: "任务详情", close: "关闭任务详情", loading: "正在加载任务详情", failed: "任务详情加载失败",
    networkError: "无法连接服务，请检查本地服务后重试。", notFoundError: "这个任务已无法读取，请刷新任务图。",
    loadError: "暂时无法读取任务详情，请重试。", retry: "重试详情", ready: "可开始", blocked: "被阻塞",
    stale: "任务详情与当前任务图不同，刷新后可查看一致的进度和关系。", refreshGraph: "刷新任务图",
    description: "描述", noDescription: "暂无描述", relationsMetadata: "任务关系与元数据", dependencies: "前置依赖", noDependencies: "无前置依赖",
    blockers: "当前未完成的前置", noBlockers: "所有前置已完成", successors: "任务图快照中的直接后续",
    successorsMissing: "当前任务尚未包含在任务图中，请刷新任务图以查看后续关系。", noSuccessors: "无后续任务",
    created: "创建时间", updated: "更新时间", taskId: "任务 ID",
    footer: "前置与阻塞项来自最新详情，名称与后续关系来自任务图快照。", countedHeading: ({ label, count }) => `${label} · ${count}`,
  },
  pr: {
    title: "关联 PR", heading: ({ count }) => `关联 PR · ${count}`, range: ({ start, end, total }) => `第 ${start}–${end} 项，共 ${total} 项`,
    previous: "上一页", next: "下一页", page: "页码", pageLabel: "关联 PR 页码", pageOption: ({ page, total }) => `${page} / ${total}`,
    empty: "暂无关联 PR", emptyString: "（空字符串）", url: "URL",
  },
  attachments: {
    openInNewTab: "在新标签页打开", missing: "找不到此附件，文件可能已被删除。", returnToTask: "返回任务所在项目",
    title: "附件", heading: ({ count }) => `附件 · ${count}`, refresh: "刷新附件", chooseFile: "选择一个文件", targetPath: "目标相对路径",
    pathPlaceholder: "例如 docs/design.md", uploading: "正在上传…", upload: "上传文件", uploadHint: "每次上传一个文件；相同路径会直接覆盖。",
    invalidPath: "请输入有效的相对文件路径，使用 / 分隔目录，不含空段、. 或 ..。", writeError: "附件操作失败，请检查后重试。",
    loading: "正在加载附件…", listError: "附件列表加载失败。", incompleteList: "附件列表尚未完整加载，以下仅显示已读取的文件。",
    retry: "重试附件", empty: "暂无附件，上传文件后即可在这里浏览。", files: "附件文件", choosePreview: "选择文件查看预览、下载或删除。",
    preview: "附件预览", fileMetadata: ({ contentType, size }) => `${contentType} · ${size}`, download: "下载", deleting: "正在删除…", delete: "删除",
    previewLoading: "正在加载预览…", previewLoadError: "无法加载文件预览，请重试或下载文件。", previewReadError: "无法读取文件预览，请重试或下载文件。",
    retryPreview: "重试预览", frameTitle: ({ kind, path }) => `${kind} 预览：${path}`, unsupportedPreview: "此文件暂不支持预览，请下载后打开。",
  },
};
