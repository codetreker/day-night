import { getFormats } from '../../formats';
import type { GraphMessages } from '../graph';

const { number } = getFormats('zh-CN');

export const graph: GraphMessages = {
  chainList: '任务链列表',
  standaloneTask: '独立任务',
  rootSummary: ({ total, remaining }) => `${number(total)} 个任务 · ${number(remaining)} 个未完成`,
  progress: ({ done, total }) => `${number(done)}/${number(total)} 已完成`,
  rootRegion: ({ title }) => `${title} 的任务依赖图`,
  showCompletedCount: ({ count }) => `显示已完成任务链（${number(count)}）`,
  chainSummary: ({ shown, total }) => `最新创建在前 · ${number(shown)} / ${number(total)} 条任务链`,
  chainSummaryLabel: ({ shown, total }) => `显示 ${number(shown)} 条，共 ${number(total)} 条任务链`,
  chainNote: '按根任务创建时间倒序排列，从没有前置依赖的任务开始展开。共享任务可能出现在多条任务链中，各链进度不能相加作为项目总数。',
  emptyTitle: '暂无任务链',
  emptyDescription: '存在依赖关系的任务会显示在这里，独立任务可在另一个页签查看。',
  completedTitle: '所有任务链已完成',
  completedDescription: ({ count }) => `已隐藏 ${number(count)} 条已完成任务链，项目统计仍包含全部任务。`,
  showCompleted: '显示已完成任务链',
  shared: '共享',
  blocked: '被阻塞',
  external: '外部前置',
  nodeLabel: ({ title, status, blocked, external, shared }) => [title, status, ...(blocked ? ['被阻塞'] : []), ...(external ? ['外部前置'] : []), ...(shared ? ['共享任务'] : [])].join('，'),
  expandTitle: ({ direction, tasks }) => `展开${direction === 'prerequisites' ? '前置' : '后续'} ${number(tasks)}`,
  expandSummary: ({ edges, remaining }) => `+${number(edges)} 条依赖${remaining > 0 ? ` · 余 ${number(remaining)}` : ''}`,
  expandLabel: ({ direction, tasks, edges, remaining }) => {
    const label = direction === 'prerequisites' ? '前置' : '后续';
    return `展开${label} ${number(tasks)} 个任务、${number(edges)} 条依赖${remaining > 0 ? `，剩余 ${number(remaining)} 个${label}未展开` : ''}`;
  },
  resetOverview: '收起到概览',
  visibilitySummary: ({ visible, total, edges, totalEdges }) => `当前显示 ${number(visible)}/${number(total)} 个任务 · ${number(edges)}/${number(totalEdges)} 条依赖。通过卡片下方按钮展开更多前置或后续。`,
  dependencyGroup: '任务依赖关系',
  dependencyLabel: ({ source, target }) => `前置任务 ${source} → 后续任务 ${target}`,
  fullscreenTitle: '任务依赖图全屏查看',
  title: '横向依赖图',
  counts: ({ main, external, dependencies }) => `${number(main)} 个链内任务 · ${number(external)} 个外部前置 · ${number(dependencies)} 条依赖`,
  enterFullscreen: '全屏查看',
  exitFullscreen: '退出全屏',
  instructions: '点击卡片查看详情，通过卡片底部控件展开前置或后续。拖动画布平移，滚轮或按钮缩放。Tab 选择控件，Enter 或空格操作。',
  canvas: '任务依赖画布',
  directionLegend: '箭头表示前置 → 后续',
  externalLegend: '虚线节点及连线：外部前置 · 展开仅影响当前画布',
  layoutErrorTitle: '任务图布局失败',
  layoutErrorDescription: '无法绘制此任务链，请刷新项目后重试。',
  flowAriaLabels: {
    'controls.ariaLabel': '任务图视口控制',
    'controls.zoomIn.ariaLabel': '放大',
    'controls.zoomOut.ariaLabel': '缩小',
    'controls.fitView.ariaLabel': '适应画布',
    'controls.interactive.ariaLabel': '切换图交互',
    'node.a11yDescription.default': '使用 Tab 选择卡片主体或展开控件，按 Enter 或空格操作。',
    'node.a11yDescription.keyboardDisabled': '使用 Tab 选择卡片主体或展开控件，按 Enter 或空格操作。',
    'node.a11yDescription.ariaLiveMessage': ({ x, y }) => `任务已移动至 x：${number(x)}，y：${number(y)}。`,
    'edge.a11yDescription.default': '依赖箭头从前置任务指向后续任务。',
    'minimap.ariaLabel': '任务图概览',
    'handle.ariaLabel': '任务依赖连接',
  },
};
