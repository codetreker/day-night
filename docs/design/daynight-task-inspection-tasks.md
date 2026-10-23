# 任务依赖追踪与详情阅读任务拆分

本文记录各项实现范围与验收责任；[要求](../spec/daynight-task-inspection.md)、[设计](daynight-task-inspection.md)和[原型](mockups/task-inspection/index.html)拥有行为、机制与视觉。完整上下文、渐进图检查、独立 Details、平滑路线与居中详情已实现；Markdown 描述、附件导航和 bundled skill 指引也已实现。任务状态、dependsOn、PR 与源码绑定交付证据以 Daynight 和任务专属主附件为准。

| 任务 | 目的 | 实现情况 |
|---|---|---|
| UX-T1 | 完整上游数据与上下文 | 已实现 |
| UX-T2 | 渐进图上的独立依赖检查 | 已实现 |
| UX-T3 | 居中详情 | 已实现，保留附件面板/分屏/独立预览 |
| UX-T4 | Markdown描述和bundled skill | 已实现 |

每项主附件拥有本任务 Solution 和 Acceptance criteria，描述自足说明行动、范围、交付物、约束、简明完成条件与实际输入。共享规范/设计引用真实所有者。验收证据必须绑定被测源码。

## UX-T1：完整上游上下文

历史交付：完整上下文、独立计数与可访问初始视口已交付，机制和取舍见[完整上下文决策](../../.agents/notes/implemented/feature/2026-10-22-complete-prerequisite-context.md)。完整 P 数据保证继续有效；[渐进图决策](../../.agents/notes/implemented/feature/2026-10-22-progressive-task-graph.md)部分替代其全量同时可见规则，以下保留原始范围和验收。

### 方案

调整 `projectRoot`，保留根及全部后续作为链内主体，对主体递归展开前置闭包，将额外节点作为外部前置；显示所有前置关系，排除外部前置的无关后续。`rootProgress`、聚合状态和项目统计保持原有计数语义。同步节点外部上下文文案、图例、工具栏计数和初始视口，保证根左侧的外部前置可访问。

本项交付投影，不改变卡片打开详情的操作、连线路径算法或描述呈现。同步投影决策、看板要求/设计、生产组件原型与受影响的验收说明。外部上下文变多时仍保留完整内容及既有容量预算。

### 验收标准

- `A → D`、`B → C → D`、`C → X` 中展开 A 显示 A/B/C/D，排除 X；链内计数仍为 A/D。
- 多级外部前置、菱形、共享和已完成依赖均完整去重；图中边集覆盖所有显示任务的前置关系。
- 工具栏区分链内任务和外部前置，图例和可访问名称使用“外部前置”，并说明已补齐全部上游。
- 桌面和 320px 下可通过初始视口、平移、缩放及键盘访问全部节点；原有根排序、展开偏好、过滤和独立任务行为正确。
- 受影响模型、布局、组件与生产浏览器检查通过，保留现有容量矩阵，补充外部祖先密集场景的真实测量。

## UX-T2：渐进图上的独立依赖检查

### 渐进浏览

采用50真实任务/100诱导边初始概览、稳定后续优先accepted-only BFS、显式20直接邻居方向批次、准确增量/剩余数、无手动边上限、全局reset和实际S刷新根连通修剪。完整P、M进度/状态和七项统计保持。53真实场景（29原生/24容器）、四个完整输入×五次及原预算继续作为验收要求。

### 检查与详情

继承已实现的 proposed→approve→todo 生命周期及详情会话。审批、冲突和结果核对由[生命周期决策](../../.agents/notes/implemented/feature/2026-10-22-task-approval-lifecycle.md)及看板要求/设计拥有；图节点不提供版本或隐式审批，独立 Details 接入同一 session 与附件阅读组件。

主体切换图局部选择，独立Details以链接视觉打开现有居中详情。完整H从全数据计算，只高亮当前可见祖先及它们的全部真实可见路线/箭头，隐藏H−S按任务ID去重提示。选中/前置样式不同，状态色/共享/阻塞/外部虚线保持。同卡片/空白清除，另卡片替换；高亮、Details开关和关系导航不展开、不布局、不编译几何或改变视口。

采用统一列间HV通道、源右中心/目标左中心、16单位净空与≤12单位Q圆角，保留全部可见真实边及平滑/虚线/箭头语义。图局部Context与稳定受控几何分离。当前TaskDetailPanels、附件分屏/独立预览、locale、鉴权边界与手动/定时刷新触发保持，不扩大为Markdown或skill实施。

### 验收与完成

- 独立复算P/S/H、可见role/边及隐藏去重，覆盖链、菱形、共享、外部/无关后续、proposed/完成与无依赖根。
- 验证无嵌套兄弟控件、鼠标/键盘/两语言/桌面320px；高亮、Details和关系前后S、节点、路线、pieces与viewport保持。
- 保留50/100/20、reset/展开焦点、actualS刷新、mandatory visibility；普通失败只在同身份/项目/authscope保留，401/会话/资源转换沿用私有数据失效规则，dialog焦点不被抢。
- 所有实际路线/端点/相切/避让/CTM/bodycoverage/弧长/phase/箭头由独立判断器验证，无生产planner/curve预期；缺/多边、错误箭头、穿卡片和phase/coverage负例失败。
- 保留53场景（29原生/24容器）、四个完整1000任务/999或5000边输入×五次、超限/coverage/timeout/零retry/cleanup；新增selectMs≤300及精确hidden上游，保持open≤3000与detail/zoom/pan≤300和普通/高亮close→立即zoom/pan序列，无额外等待/reset/fit。
- 验收覆盖 build/typecheck/tests/coverage、真实 component/native/container/capacity 和独立审查。实际审批、required checks 和合并结果记录在 Daynight 与任务专属主附件中。

## UX-T3：居中任务详情

实现状态：居中外壳、响应式阅读布局及既有 modal 生命周期已实现，机制和取舍见[居中详情决策](../../.agents/notes/implemented/feature/2026-10-22-centered-task-detail-dialog.md)。Daynight 记录其验证及交付状态。

### 方案

`TaskDetailDialog` 使用设计中的居中尺寸、视口边距和内部滚动。保留 PR、附件、完整文本、关系、元数据、局部错误与快照差异提示。所有已有打开详情的回调继续调用同一外壳；图内独立 Details 和独立任务条目均打开同一外壳。

复用 portal、共享滚动锁、inert、焦点循环和分层 Esc，保留框架卸载阶段与恢复焦点阶段的既有区分。同步详情、全屏、附件 frame 生命周期文档和生产组件原型。图内选择和独立任务/任务链标签分类不归本项。

### 验收标准

- 1440px 和 320px 下窗口相对可用视口居中，符合 960px 宽度上限和 24px/12px 边距，高度不超过可用视口，页面无整体横向溢出。
- 长内容仅在内容区及代码/表格局部滚动，关闭控件持续可访问；加载、失败、重试、空内容和快照变化提示可用。
- 关闭按钮、遮罩及 Esc 正确关闭，背景不可操作，Tab 在详情内循环，关系切换不重新恢复旧焦点。
- 普通图和全屏图均正确打开与恢复焦点；Esc 先关闭详情，再退出全屏。刷新移除入口、画布卸载及附件 HTML/PDF frame 不遗留锁或 inert。
- 受影响组件及真实原生/容器浏览器检查通过；验证独立任务条目直接打开同一居中详情和条目消失时的焦点回退。

## UX-T4：Markdown 任务描述

### 方案

`TaskDetailReading` 持有单个 `useAttachments`，将同一控制器传给描述导航、`TaskDetailPanels` 与 `TaskAttachmentsPanel`。`MarkdownContent` 共享 CommonMark/GFM 渲染及样式，描述显式以任务附件根解析相对 URL；附件 Markdown 继续使用实际文档目录。描述普通相对附件链接激活附件页签，复用详情内唯一附件控制器选中已有预览，保留真实 href 与浏览器原生特殊点击。普通链接使用真实 href；修饰键、非主键、上下文菜单及 query/hash 导航保持浏览器行为。完整清单之前不报告缺失，加载、清单失败、非法路径、缺失与预览错误分别可见并保留适用重试；切换 task、关闭详情或鉴权/资源失效取消读取并排除晚到响应。

同步仓库发布源中的 `using-daynight` 入口与模式指引、skill 需求/设计及 README，明确 Markdown 自足任务简介和已确认资料引用的写法，正文包含具体动作、范围、交付物、约束及简明完成条件。任务专属主 Markdown 附件继续拥有详细方案、完整验收和执行证据。API/CLI 原始字符串、完整替换字段及版本控制语义保持一致。同步看板、附件 Markdown 文档、相应决策和生产组件原型。

### 验收标准

- 中英文标题、列表、代码、引用、表格、链接、图片、长文本及空描述正确显示；原始 HTML 按文本呈现，unsafe URL 沿用原策略，320px 无页面溢出且代码/表格局部横向滚动。
- `[方案与验收](plan.md)`、`[交互原型](mockui/index.html)` 和相对图片从当前任务根解析；附件文件内的相对引用继续以文档目录解析。
- 普通无 query/hash 的相对附件链接激活当前详情的附件页签，选择并聚焦预览；修饰键、非主键、绝对 URL、fragment 和 query/hash 保留设计定义的 URL 行为。
- 分页未完成、续页失败/重试、缺失附件、非法上越路径、预览失败、同路径覆盖 revision 以及 task/关闭/auth 失效后的旧响应均有正确行为；不重复建立附件控制器，保持 split pane、唯一右滚动、frame 键盘与焦点恢复。
- CLI 写入/读取保留原始 Markdown 字节，实际 npm 包含同步后的 skill 全部资源，frontmatter、相对链接、create-task/run-task 行为及安装后内容验证通过。
- 受影响 CLI/Web 检查及真实服务/浏览器描述与附件引用路径通过，保留当前场景/容量输入、阈值、零重试和清理；普通/Goal 自足简介、主附件所有权、权限规则和独立附件写入语义保持正确。源码绑定验收、审批和交付状态由对应 Daynight 任务与主附件记录。

## 任务资料与实现文档

本组 UX 任务的原登记要求是每项准备 `plan.md`、要求与设计副本、可独立运行的
`mockui/index.html` 及资源，正文保留问题与实际上传链接。该历史要求保留原任务的
资料背景，不将复制整包作为新的通用登记规则，也不据此推断既有服务附件已迁移。

当前和后续登记遵守 [skill 要求](../spec/daynight-agent-skill.md)：description 自足说明
具体问题、行动、范围、交付物、约束和简明可观察完成条件；详细方案、完整验收与证据
归任务专属主附件。共享要求、设计和适用原型引用实际来源，附件按任务需要归属，独立
快照记录来源版本与目的。执行前读回真实任务、专属附件与共享输入，确认内容和资源
可用。

实现时维护 [Web 要求](../spec/daynight-web.md)、[Web 设计](daynight-web.md)、[Web 验收说明](../../packages/daynight-web/README.md)、图投影/虚线绘制/详情与全屏的相关决策。Markdown 任务同时维护 [skill 要求](../spec/daynight-agent-skill.md)、[skill 设计](daynight-agent-skill.md)、[附件要求](../spec/daynight-task-attachments.md)和[附件设计](daynight-task-attachments.md)的适用条款。各项只更新自己的当前事实，保留历史决策的原始理由。
