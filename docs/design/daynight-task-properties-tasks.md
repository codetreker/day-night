# Task 预定义属性实施任务

状态：TP-T1 服务端与 TP-T2 CLI 已实现；TP-T3 网页待实施。
[需求](../spec/daynight-task-properties.md)拥有 TP1–TP9 与 TP-V1–TP-V8，
[架构设计](daynight-task-properties.md)拥有类型、事务、存储、CLI 和网页机制，
[决策记录](../../.agents/notes/implemented/architecture/2026-10-21-task-properties-design.md)
拥有取舍。本文定义实施边界、依赖与可观察的完成条件。

## 顺序与公共约束

| 任务 | 前置 | 交付目的 | 状态 |
|---|---|---|---|
| TP-T1 | 无 | 服务端持久化与发布预定义 PR 属性 | 已交付：[PR #83](https://github.com/codetreker/daynight/pull/83)，合并提交 `0cece99` |
| TP-T2 | TP-T1 | CLI 创建、替换、清空与显示关联 PR | 已实现；验证结果随对应源码与 CI 保存 |
| TP-T3 | TP-T1 | 网页详情呈现关联 PR | 待实施 |

每个任务按一个目的形成可独立审查的改动，使用该任务自己的一个共享 worktree。
TP-T2 与 TP-T3 的依赖相同，可在 TP-T1 交付后分别推进。已打开的附件设计或其他
任务不成为本方案的前置；迁移编号与文件中的真实最新主线协调。

所有任务保留字符串内容、列表顺序与重复项；任何检查都不得增加 PR 格式、存在性、
标题内容或仓库匹配要求。未知输入结构、版本冲突和持久化失败必须暴露。每个
实现任务同步相关 active 文档及决策中的实施状态，并记录其真实源码/PR/CI 证据。

## TP-T1 服务端 PR 属性

归属：`packages/daynight-server/api/`、`internal/core/`、`internal/core/store/`、
`internal/service/`、`internal/server/`、进程验收以及相关 server 文档。

- 定义具体领域类型、HTTP DTO、可选属性 patch 与有序数组等值比较。
- 新增有序数据库迁移，注册 embed/checksum；已有行得到空列表，版本与时间保持。
- 以序列化 JSON text 保存属性，接入完整 task 投影及同一行 create/update。
- 嵌套严格结构解析保留未知字段与重复 key 拒绝，完全复用既有请求限制和错误码。
- 旧客户端省略属性时保持现值；图响应与列表查询参数不扩展。

完成条件：

1. TP-V1–TP-V5、TP-V8 的 server 路径在真实 PostgreSQL 与真实 HTTP 进程中成立。
2. 混合属性与依赖写入后的故障注入证明完整回滚；并发同版本写入为一个成功、一个
   version_conflict，取消和无变化路径保留既有语义。
3. 请求 JSON 中的 NUL 转义、空值、重复项和任意地址可持久化并经重启读回；坏存储
   文档明确报错，迁移使用真实旧 schema 并验证数据与时间戳。
4. 运行 server README 的 `bash scripts/check.sh`，使用隔离数据库；build、vet、
   race、go-cov 及全部必需门槛成功，总语句覆盖率未舍入值严格大于 90%。

## TP-T2 CLI PR 属性

归属：`packages/daynight/src/api/`、`src/commands/task/`、对应测试、安装产物与
真实服务验收；共享命令 schema 只在证明现有机制不足时调整。

- 资源类型和完整解析包含 properties；PR 字符串不使用 title 的内容校验器。
- 新增可重复 URL/title 选项，按各自出现顺序配对；Update 支持清空及参数互斥。
- 属性-only 更新使用既有版本控制、期限、project 选择与不自动重试行为。
- 完整文本和 JSON 输出保留全部引用，帮助及补全同步固定选项。

完成条件：

1. TP-V1、TP-V3、TP-V6、TP-V8 的客户端路径成立；成对参数错误和互斥冲突在任何
   配置、Git 或网络 I/O 之前失败。
2. 编译入口与安装产物对真实 Go/PostgreSQL 服务完成创建、替换、清空、冲突和
   读回；HTTP fixture 另外验证 CLI 参数无法携带的控制字符响应及 JSON 原值。
3. `pnpm typecheck`、`pnpm test`、`pnpm build` 及适用安装验收成功；帮助与
   Bash/zsh 补全通过既有实壳验证。按实施时主线版本满足现有 CLI 发布版本门禁。

## TP-T3 网页 PR 属性

归属：`packages/daynight-web/src/api/`、`features/task-detail/`、对应样式和
测试、生产浏览器验收及 mockup。图计算和图响应保持精简。

- 完整 task 解析接收固定属性结构；缺失或错误响应保持显式错误。
- 按设计预览实现只读 PR 区域，覆盖数量、空态、空字符串标记、顺序、重复和换行。
- 任意字符串以文本展示，仅 HTTP(S) 绝对地址提供隔离的新标签页导航。
- 沿用详情请求取消、局部重试、关闭焦点恢复与快照刷新提示。

完成条件：

1. TP-V1、TP-V7、TP-V8 的网页路径在生产构建、真实服务和隔离数据库中成立。
2. 浏览器验证普通、多项、空、重复、空字符串、控制/长文本和不可导航地址；确认
   输入不会执行脚本/HTML，且 320px 页面无整体横向溢出。
3. 更新属性后重新打开详情得到新值，旧图快照出现既定刷新提示；详情加载失败
   保持错误态。Esc、Tab 焦点约束、关闭按钮及焦点恢复保持有效。
4. 适用 `pnpm web:typecheck`、`pnpm web:test`、`pnpm web:build` 与
   `pnpm web:acceptance` 成功，覆盖率满足现有严格门槛；最终结果随对应源码保存。
