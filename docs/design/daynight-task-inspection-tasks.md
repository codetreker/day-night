# 任务依赖追踪与详情阅读任务拆分

状态：UX1、UX3与渐进概览 [PR #134](https://github.com/codetreker/daynight/pull/134) 已交付，后者合并为 `53e3a0c0ff4ec821f74a2401a3bfa7de24a3f4ea`。当前 #121 实现独立检查/Details/平滑路线，当前 head 验收待完成；合并后才将 UX2 完成。UX4 待实现。[要求](../spec/daynight-task-inspection.md)、[设计](daynight-task-inspection.md)和[原型](mockups/task-inspection/index.html)拥有行为、机制与最终视觉。实际 task 状态和依赖以 Daynight 为准，dependsOn 是前置关系唯一记录。

| 任务 | 目的 | 交付状态 |
|---|---|---|
| UX-T1 | 完整依赖上下文数据 | PR #119 已交付 |
| UX-T2 | 渐进概览上的稳定依赖检查 | PR #134 已交付，#121 当前 head 验收及合并待完成 |
| UX-T3 | 居中任务详情 | PR #124 已交付；当前面板/附件分屏由主线后续交付拥有 |
| UX-T4 | Markdown 描述及发布 skill | 待实现 |

每个 PR 负责自己的代码、文档、note、组件原型、独立审查及真实验收；已有基线通过不证明后续 head 通过。Daynight 主附件保留方案、验收和源码绑定交付证据。

## UX-T1：完整上游上下文

历史交付：完整上下文、独立计数与可访问初始视口已交付，机制和取舍见[完整上下文决策](../../.agents/notes/implemented/feature/2026-10-22-complete-prerequisite-context.md)。完整 P 数据保证继续有效；[渐进图决策](../../.agents/notes/implemented/feature/2026-10-22-progressive-task-graph.md)部分替代其全量同时可见规则，以下保留原始范围和验收。

### 原始交付范围

调整 `projectRoot`，保留根及全部后续作为链内主体，对主体递归展开前置闭包，将额外节点作为外部前置；显示所有前置关系，排除外部前置的无关后续。`rootProgress`、聚合状态和项目统计保持原有计数语义。同步节点外部上下文文案、图例、工具栏计数和初始视口，保证根左侧的外部前置可访问。

本项交付投影，不改变卡片打开详情的操作、连线路径算法或描述呈现。同步投影决策、看板要求/设计、生产组件原型与受影响的验收说明。外部上下文变多时仍保留完整内容及既有容量预算。

### 原始验收标准

- `A → D`、`B → C → D`、`C → X` 中展开 A 显示 A/B/C/D，排除 X；链内计数仍为 A/D。
- 多级外部前置、菱形、共享和已完成依赖均完整去重；图中边集覆盖所有显示任务的前置关系。
- 工具栏区分链内任务和外部前置，图例和可访问名称使用“外部前置”，并说明已补齐全部上游。
- 桌面和 320px 下可通过初始视口、平移、缩放及键盘访问全部节点；原有根排序、展开偏好、过滤和独立任务行为正确。
- 受影响模型、布局、组件与生产浏览器检查通过，保留现有容量矩阵，补充外部祖先密集场景的真实测量。

## UX-T2：渐进概览上的依赖检查

### 已交付：PR #134 渐进概览

PR134已完成50/100概览、20直接邻居显式批次、完整诱导边、全局reset、实际S刷新根连通协调及mandatory visibility[5]，并以31项真实native/container场景和原始四个完整输入×五次、既有预算验证，CI/approval后平台确认合并。它拥有渲染工作负载政策；当前检查PR继承该基线，不重新交付它。原进度/七统计/四状态、locale、TaskDetailPanels/附件分屏和鉴权资源边界保持。

### 当前：#121 独立检查、Details 与平滑连线

主体从打开详情改为切换图局部检查，Details是独立兄弟按钮，方向按钮沿用PR134。从完整数据算H，只高亮可见H及真实连接线/箭头，按ID去重显示隐藏上游；检查不改S/位置/路线/pieces/视口。Details与关系导航仅更新原详情资源。reset或同作用域刷新后选择仍可见则重算，否则清除，普通失败保留旧图；鉴权401/会话/身份或项目转换继续清理私有状态。

保留可见Dagre节点布局，规划固定源右中心/目标左中心及无障碍rank通道，Q对称裁切≤12，真实曲线弧长保持5/4相位和≤0.025CSSpx最大缩放误差。声明式原生SVG、三个恒定RGBmarker和body局部stroke继承保留每条可见真实边/箭头。TaskInspectionContext隔离检查状态与受控节点几何，memoized内容保持稳定。

### 当前 PR 验收

- 完整H、共享/外部/proposed/完成祖先、隐藏数、可见role与边准确；同卡片/空白清除和切换正确，不自动展开或变更几何/视口。
- 主体/Details/方向控件鼠标与键盘、桌面/320px、locale、全屏层级Escape、关系导航和现有附件面板正确；刷新不抢dialog焦点，footer消失/整卡片移除恢复合理。
- PR134可见基线、精确增量/reset/actualS刷新及mandatory visibility行保持。所有普通失败保留只在原authscope；401/身份/项目转换保留私有资源失效规则。
- 独立API可见拓扑与真实DOM端口/Q相切/避让/CTM/bodycoverage/弧长/phase/原生marker判断全部执行，无生产planner预期。compilerInputs只做忠实度，缺/多边、错误箭头、穿节点及phase/coverage负例失败。
- 四个完整1000任务/999或5000边输入各五次不变，visibility[5]增加非空selectedId、精确hiddenUpstream，selectMs≤300；open≤3000和detail/zoom/pan≤300。普通详情→close→立即zoom/pan，可信选择后高亮态重复；每metric取较慢state，network独立，不加等待/reset/fit。
- 31场景、双语、真实目标、超限、coverage、timeout、零retry及cleanup保持；当前head需build/typecheck/unit/component/native/container/capacity与exact-head review。required checks、非作者approval、处理阻塞线程及mergeability后受保护合并，平台确认#121已合并才将任务完成。

## UX-T3：居中任务详情

交付状态：已由 [PR #124](https://github.com/codetreker/daynight/pull/124)（`e274769`）合并。居中外壳、响应式阅读布局及既有 modal 生命周期已实现，机制和取舍见[居中详情决策](../../.agents/notes/implemented/feature/2026-10-22-centered-task-detail-dialog.md)。Daynight 记录其验证及交付状态。

### 方案

`TaskDetailDialog` 使用设计中的居中尺寸、视口边距和内部滚动。保留 PR、附件、完整文本、关系、元数据、局部错误与快照差异提示。所有已有打开详情的回调继续调用同一外壳；图内独立入口继续调用它，独立任务条目仍直接打开。

复用 portal、共享滚动锁、inert、焦点循环和分层 Esc，保留框架卸载阶段与恢复焦点阶段的既有区分。同步详情、全屏、附件 frame 生命周期文档和生产组件原型。图内选择和独立任务/任务链标签分类不归本项。

### 验收标准

- 1440px 和 320px 下窗口相对可用视口居中，符合 960px 宽度上限和 24px/12px 边距，高度不超过可用视口，页面无整体横向溢出。
- 长内容仅在内容区及代码/表格局部滚动，关闭控件持续可访问；加载、失败、重试、空内容和快照变化提示可用。
- 关闭按钮、遮罩及 Esc 正确关闭，背景不可操作，Tab 在详情内循环，关系切换不重新恢复旧焦点。
- 普通图和全屏图均正确打开与恢复焦点；Esc 先关闭详情，再退出全屏。刷新移除入口、画布卸载及附件 HTML/PDF frame 不遗留锁或 inert。
- 受影响组件及真实原生/容器浏览器检查通过；验证独立任务条目直接打开同一居中详情和条目消失时的焦点回退。

## UX-T4：Markdown 任务描述

### 方案

提取共享 Markdown 渲染视图，描述按 CommonMark/GFM 展示，使用任务附件根解析相对 URL；附件 Markdown 继续使用文档目录。描述普通相对附件链接激活附件页签，复用详情内唯一附件控制器选中已有预览，保留真实 href 与浏览器原生特殊点击。完整清单、路径和预览错误保持可见，切换 task 或关闭时取消读取。

同步仓库发布源中的 `using-daynight` 入口与模式指引、skill 需求/设计及 README，明确 Markdown 问题描述和已确认附件链接的写法。一个主 Markdown 附件继续拥有方案、验收和执行证据。API/CLI 原始字符串、完整替换字段及版本控制语义保持一致。同步看板、附件 Markdown 文档、相应决策和生产组件原型。

### 验收标准

- 标题、列表、代码、引用、表格、链接、中文长文本及空描述正确显示；原始 HTML 按文本呈现，代码/表格局部滚动。
- `[方案与验收](plan.md)`、`[交互原型](mockui/index.html)` 和相对图片从当前任务根解析；附件文件内的相对引用继续以文档目录解析。
- 普通无 query/hash 的相对附件链接激活当前详情的附件页签，选择并聚焦预览；修饰键、非主键、绝对 URL、fragment 和 query/hash 保留设计定义的 URL 行为。
- 加载、清单失败、缺失附件、非法上越路径、内容失败以及切换 task 后旧响应均有正确行为；不重复建立附件控制器。
- CLI 写入/读取保留原始 Markdown 字节，实际 npm 包含同步后的 skill 全部资源，frontmatter、相对链接、create-task/run-task 行为及安装后内容验证通过。
- 受影响 CLI/Web 检查及真实服务/浏览器描述与附件引用路径通过；现有主附件所有权和独立附件写入语义保持正确。

## 任务资料与实现文档

每项 Daynight 任务上传自己的 `plan.md`、本要求与设计的副本，以及可独立运行的 `mockui/index.html` 和所需资源。任务 description 只说明问题与实际上传链接；验收和方案留在主附件。登记后读回任务与附件内容，确认引用和资源路径可用。

实现时维护 [Web 要求](../spec/daynight-web.md)、[Web 设计](daynight-web.md)、[Web 验收说明](../../packages/daynight-web/README.md)、图投影/虚线绘制/详情与全屏的相关决策。Markdown 任务同时维护 [skill 要求](../spec/daynight-agent-skill.md)、[skill 设计](daynight-agent-skill.md)、[附件要求](../spec/daynight-task-attachments.md)和[附件设计](daynight-task-attachments.md)的适用条款。各项只更新自己的当前事实，保留历史决策的原始理由。
