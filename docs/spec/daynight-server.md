# daynight-server 任务管理需求

状态：Go 服务、事务存储、project/task 用例与 HTTP 接口、覆盖率门槛和完整进程
验收均已实现。[服务端验证说明](../../packages/daynight-server/README.md#built-process-acceptance-and-ci-evidence)
定义验证范围、要求与测试映射和 CI 产物解释；逐次运行结果随对应 PR 与 CI 保存。

本文定义 `daynight-server` 面向本机 CLI 和内部程序的任务管理行为。
[技术设计](../design/daynight-server.md)拥有分层、存储和并发机制；
[设计决策](../../.agents/notes/implemented/architecture/2026-10-19-daynight-server-task-design.md)
记录取舍和范围。

[预定义属性需求](daynight-task-properties.md)扩展本文的 task 资源，PR 引用的
服务端存储、更新与迁移已实现；[架构](../design/daynight-task-properties.md)拥有机制。

[附件需求](daynight-task-attachments.md)扩展本文的服务基线：本地内容、PG 元数据、
单文件 API 和固定预览路径已实现，CLI 与 Web 管理界面按其任务继续交付。其
[架构](../design/daynight-task-attachments.md)拥有附件机制。

[鉴权需求](daynight-auth.md)定义已接入主站的 UniAuth 登录、Daynight 会话、个人
访问令牌和项目成员授权；[架构](../design/daynight-auth.md)拥有机制。全部 project、task、
图和附件业务请求必须通过认证，并按项目成员关系授权。已有项目后续手工补齐成员，
零成员项目不可访问。[统一启用决策](../../.agents/notes/implemented/architecture/2026-10-22-authentication-activation.md)
记录运行时接线与验收凭据边界；对应源码的验证结论仍以完整运行回执为准。

[执行计时需求](daynight-task-timing.md)的任务起止事实与数据库图时间样本已实现。
本文拥有它们的资源、写入和快照约定；项目提醒阈值及管理员设置接口已实现，实时卡片使用同一资源事实，当前展示由[看板需求](daynight-web.md)拥有。

## 目标与交付范围

| 编号 | 要求 |
|---|---|
| R1 | 使用 Go 实现独立的 `daynight-server`，使用 PostgreSQL 持久化业务数据 |
| R2 | 支持创建、列表查询和读取关联一个 repo 地址的 project |
| R3 | 在 project 内支持创建、列表查询、读取和更新 task |
| R4 | task 支持同 project 内的依赖关系，任何成功提交都必须保持无环 |
| R5 | task 创建为 `proposed`，经 approve、claim、complete 进入 `todo`、`in_progress`、`done`；unapprove 仅允许 todo→proposed；开始或完成要求全部直接前置已完成，通用更新不可写 status |
| R6 | task 更新必须支持版本冲突检测，字段和依赖必须原子提交 |
| R7 | 通过 HTTP JSON API 提供上述行为，错误和分页具有明确语义 |
| R8 | 采用 `api / service / server / core` 分层，store 位于 `core` 内 |
| R9 | 使用真实 PostgreSQL 验证存储与并发行为，通过 `go-cov` 执行覆盖率门禁 |
| R10 | 服务启动、关闭、请求取消和失败必须可观测，持久化失败不得伪装成成功或空列表 |

服务与现有 TypeScript 客户端的 review 命令 分别管理各自的数据和生命周期。创建 project
只登记 repo 地址，不触发 clone、GitHub 请求、review 启动或 CLI 配置修改。
客户端的[需求](daynight.md)与 review 的[需求](daynight-review.md)分别由其自身文档定义。

## Project

Project 包含以下字段：

| 字段 | 语义 |
|---|---|
| `id` | 服务生成的 UUID，不随名称或 repo 改变 |
| `name` | 必填的非空名称 |
| `repoUrl` | 必填的远程 Git repo 地址 |
| `settings` | 必填对象；`version` 为初始 `1` 的正 int64，`executionWarningMinutes` 为初始 `60` 的正 int32 分钟数 |
| `createdAt`、`updatedAt` | UTC 时间，HTTP 使用 RFC 3339 格式 |

一个 project 关联一个 repo，多个 project 可以关联同一 repo。支持 HTTPS URL、
SSH URL 和 SCP 风格 SSH 地址，地址必须包含主机和仓库路径；地址登记不验证实际访问权限。
名称必须是无 NUL 的有效 UTF-8 文本。HTTPS 地址不得包含凭据，SSH 地址允许用户名，
但不得包含密码；查询参数和 fragment
不属于仓库地址。无效地址作为输入错误拒绝，地址中 SSH 用户名不作为业务身份。

接口提供创建、列表、单项读取及专用设置修改；创建者在同一事务中成为项目管理员，
列表在数据库中先按当前成员关系过滤，再进行分页。创建后 `repoUrl` 不可通过 task 或设置更新改变。
创建、详情、列表、图内 Project 及成功设置修改均返回完整 settings。已有项目通过迁移获得 `60` 分钟、
版本 `1`，迁移保持原 createdAt/updatedAt。

设置修改只接受观察到的 `version` 和 `executionWarningMinutes`，范围分别为
`1..9223372036854775807`、`1..2147483647`。项目成员可读，只有管理员可写；
取得项目锁后重新检查当前成员和管理员身份，再检查版本，最后才判断同值空操作。
过期同值请求仍冲突，当前版本同值保存返回未改变 Project；实际数值变化只递增一次设置版本并更新 project.updatedAt，
不改 createdAt 或任务时间。降权/移除、版本冲突或存储失败不能留下部分设置更新。

## Task 与依赖

Task 包含以下持久化字段：

| 字段 | 语义 |
|---|---|
| `id` | 服务生成的 UUID |
| `projectId` | 所属 project，创建后不可变 |
| `title` | 必填的非空 UTF-8 标题，不含 NUL |
| `description` | 不含 NUL 的 UTF-8 描述，省略时为空字符串，允许更新为空字符串 |
| `properties` | server 预定义属性；当前 `pullRequests` 为有序的 `{url, title}` 字符串记录数组，默认空数组 |
| `status` | `proposed / todo / in_progress / done`，创建时为 `proposed`，只能通过专用生命周期操作转换 |
| `version` | 从 `1` 开始的正整数，每次实际变更增加一次 |
| `createdAt`、`updatedAt` | UTC 创建和最后实际变更时间 |
| `startedAt`、`completedAt` | 只读 UTC 执行起止时间，字段必填但允许 `null`，未知事实不补造 |

Task 响应还包含 `dependsOn`、`blockedBy` 和 `ready`：

- `dependsOn` 是全部直接前置 task ID，按 ID 升序返回。
- `blockedBy` 是其中尚未处于 `done` 的 task ID，按 ID 升序返回。
- `ready` 当且仅当本 task 为 `todo` 且 `blockedBy` 为空时为 `true`。

这些派生字段来自读取时的一致状态；依赖任务变化不会自动修改本 task 的 `status`、
`version` 或 `updatedAt`。`ready` 描述可开始条件，不代表已领取或已调度。`proposed` 可以有未完成前置，
其 `blockedBy` 仍列出这些前置，但 `ready` 始终为 `false`，也不计入 todo 的阻塞数。

依赖 `B dependsOn A` 表示 B 开始或完成前 A 必须完成。以下输入必须拒绝：

1. 依赖自身、重复的依赖 ID、不存在的依赖。
2. 指向其他 project 的依赖。
3. 直接或间接形成环的依赖，包括并发请求分别创建反向边的情形。

## 状态与更新规则

创建 task 总是产生 `proposed`，数据库默认值相同。创建输入只接受 `title`、可选
`description`、`dependsOn` 与 `properties`；不能指定初始 status。省略描述为空字符串，
依赖和 PR 数组省略时为空。既有 todo、in-progress、done 数据视为其实际状态，不重置
审批，不修改版本或时间戳。

| 操作 | 唯一允许前态 | 结果 | 前置要求 |
|---|---|---|---|
| approve | `proposed` | `todo` | 可含未完成前置 |
| unapprove | `todo` | `proposed` | 可含未完成前置 |
| claim | `todo` | `in_progress` | 全部直接前置已完成 |
| complete | `in_progress` | `done` | 全部直接前置已完成 |

四种操作均要求正 int64 期望 `version`，JSON 使用数字，范围为
`1..9223372036854775807`；缺失、null、字符串、非整数、非正或越界值拒绝。请求体只
包含 version，沿用严格字段、重复 key、UTF-8、大小和类型检查。当前版本不符先返回
`409 version_conflict`；版本一致但前态错误返回 `409 invalid_transition`；前置未完成
返回 `409 dependency_unsatisfied` 及有关 task ID。重复动作同样失败，不把已转换状态
当作成功，也不隐式重试。unapprove 之外不存在退回，不能重开进行中或已完成任务，也不能 todo 直接完成。

普通成员与管理员均可执行四种生命周期操作，权限来自当前项目成员关系；管理员
额外管理成员与邀请。claim 在数据库项目锁后的实际写入时记录 `startedAt` 并清空 `completedAt`，
complete 记录真实 `completedAt` 并保留起点。迁移前已在执行的任务完成时可以只有真实终点，
不能从 `createdAt` 或 `updatedAt` 推算其缺失起点。新建不生成执行时间；approve 与 unapprove 保留已有起止事实，
已有历史任务的迁移初值均为 `null`。创建、PATCH 和生命周期输入均不能写入起止字段。
HTTP 对操作及方法拒绝路由统一验证凭据，Cookie 会话写请求
要求精确主站 Origin，响应使用 no-store。

版本、前态、依赖及写入必须处于同一 project 锁事务中，先获得项目锁再检查成员关系。成功只增加一次 version 并
更新一次 updatedAt，并原子维护对应起止时间，保留其余字段、属性和依赖；拒绝保持全部数据不变。同版本并发
claim 只有一个成功，其余看到版本冲突。对同一个 ready todo 和同版本，unapprove 与 claim 只有一方成功，另一方返回版本冲突；同版本重复 unapprove 同样只有一个提交。被依赖阻塞的 todo 仍可撤回，claim 的前置拒绝不阻止该动作。撤回保留正文、属性、依赖、附件与起止时间，ready 派生为 false；后继状态及依赖边保持，未完成前置仍未满足。审批不领取任务，也不使未完成前置变为完成。
任务审批是就绪决策，不授予实现、发布、部署、合并或主线 push 的权限。

PATCH 可修改 `title`、`description`、`dependsOn` 和预定义属性，必须带读取到的
version，至少提供一个可修改字段。status 不属于 PATCH 输入；即使同时提交其他
合法字段也必须整体拒绝。省略字段保持原值，null 拒绝，`dependsOn: []` 清空依赖，
`properties.pullRequests: []` 清空 PR 引用；空 properties 本身不算修改字段。
proposed 和 todo 可以带未完成前置并修改元数据；in-progress 和 done 的完整候选
任务始终要求全部直接前置已完成。依赖仍须存在于同 project，不能重复、自身引用或成环。

过期版本即使期望字段恰与当前值相同也冲突。版本匹配的语义空操作保持 version 和
updatedAt；依赖数组顺序不构成变化，PR 数组顺序、重复项和字符串均参与等值比较。
真实字段、属性或依赖变更只增加一次版本。普通编辑及同状态低层写入保持执行起止；
再次真正进入执行时替换起点而不累加早先尝试，但这不增加公开重开转换。附件和 PR 更新不改变生命周期。

PR 的 url 与 title 只校验字符串类型及必填结构，保留空字符串、控制字符、顺序与
重复项。服务不检查 URL、PR 存在性或仓库匹配；严格拒绝未知字段、重复 key、null、
缺失项和错误类型。[属性需求](daynight-task-properties.md)拥有详细行为与验收。
[生命周期决策](../../.agents/notes/implemented/feature/2026-10-22-task-approval-lifecycle.md)保留原三状态任意更新
及读取准备阶段的历史取舍；[撤回决策](../../.agents/notes/implemented/feature/2026-10-23-task-unapprove.md)拥有 todo 专用撤回及保持既有执行边界的理由。

## HTTP API

| 方法 | 路径 | 结果 |
|---|---|---|
| `POST` | `/api/v1/projects` | 创建 project，返回 `201` 和资源 |
| `GET` | `/api/v1/projects` | 返回 project 分页列表 |
| `GET` | `/api/v1/projects/{projectId}` | 返回 project，缺失时 `404` |
| `PATCH` | `/api/v1/projects/{projectId}/settings` | 管理员按精确设置 version 修改阈值，返回 `200` 和完整 Project |
| `POST` | `/api/v1/projects/{projectId}/tasks` | 创建 task，返回 `201` 和资源 |
| `GET` | `/api/v1/projects/{projectId}/tasks` | 返回 task 分页列表 |
| `GET` | `/api/v1/projects/{projectId}/tasks/{taskId}` | 返回 task，缺失或不属于该 project 时 `404` |
| `GET` | `/api/v1/projects/{projectId}/task-graph` | 返回同一完整快照的 project、任务图和统计 |
| `PATCH` | `/api/v1/projects/{projectId}/tasks/{taskId}` | 原子更新元数据和依赖，返回 `200` 和资源 |
| `POST` | `/api/v1/projects/{projectId}/tasks/{taskId}/approve` | `proposed → todo`，返回 `200` 和完整资源 |
| `POST` | `/api/v1/projects/{projectId}/tasks/{taskId}/unapprove` | `todo → proposed`，返回 `200` 和完整资源 |
| `POST` | `/api/v1/projects/{projectId}/tasks/{taskId}/claim` | `todo → in_progress`，返回 `200` 和完整资源 |
| `POST` | `/api/v1/projects/{projectId}/tasks/{taskId}/complete` | `in_progress → done`，返回 `200` 和完整资源 |

HTTP 创建请求使用 `Content-Type: application/json`，可附带 UTF-8 charset。请求体
最多 1 MiB，必须是单个 JSON 对象；拒绝无效 UTF-8、重复 key、字段名大小写不符、
未知或只读字段、错误类型、必填字段为 `null` 和尾随 JSON。

所有成功读取返回 `200`。Project 不存在时，其 task 子路径必须返回 `404`，
不能将空 task 列表作为不存在 project 的结果。

设置 PATCH 必须同时提供 `version` 与 `executionWarningMinutes`，不接受 query 参数。
缺失、重复、未知、只读、`null`、非整数、非正或超界字段按既有严格 JSON 规则拒绝；
认证、Cookie 写 Origin 和 no-store 同样适用。成员写设置为 `403 forbidden`，非成员或缺失项目为 `404 not_found`。

Task 创建示例：

```json
{
  "title": "Implement task API",
  "description": "Expose project-scoped task endpoints.",
  "dependsOn": ["b4163ef9-93b0-4e79-b56f-4cd88f41e61a"]
}
```

Task 更新示例：

```json
{
  "version": 3,
  "title": "Implement versioned task API"
}
```

列表使用 `limit`、`cursor`。`limit` 默认 `50`，允许 `1..100`；按
`createdAt ASC, id ASC` 稳定排序，返回 `items` 和 `nextCursor`，末页后者为 `null`。
Task 列表额外支持单个四状态 `status` 和布尔 `ready` 筛选，筛选按 AND 组合。
Cursor 必须绑定列表类型、所属 project 和筛选条件，格式错误或条件不匹配返回输入错误。重复 query 参数、显式空值和未知参数也作为
输入错误拒绝；`limit` 的默认值仅用于未提供该参数。
单次响应中的 task、依赖和派生字段保持一致；多次翻页不承诺跨请求快照。

### 完整任务图

`GET /api/v1/projects/{projectId}/task-graph` 提供同一只读 `REPEATABLE READ` 快照中的
project、完整 tasks、summary 及数据库时间样本 `observedAt`，不使用分页或状态筛选。任何非空 query，包括未知
字段、分页/筛选字段和无效编码，均返回 `400 invalid_input`。成功、拒绝和读取错误
响应采用 `Cache-Control: no-store`；GET 同时支持 HEAD，其他方法返回 405 与 Allow。

summary 必须包含 `total`、`proposed`、`todo`、`inProgress`、`done`、`ready`、
`blocked`，零值也不能省略。按不同任务 ID 计数，满足
`total = proposed + todo + inProgress + done` 和 `todo = ready + blocked`。
proposed 只计入自身状态和总数；blocked 只计入前置未全部完成的 todo。任务的状态、
版本和时间不随此次读取变化。

图节点包含 `id`、`titlePreview`、`titleTruncated`、`status`、`dependsOn`、
`blockedBy`、`ready`、`createdAt`、`updatedAt` 以及明确可空的 `startedAt`、`completedAt`。
顶层 `observedAt` 是图数据与统计读取后的数据库时间样本，使用 UTC RFC 3339；
它不是事务开始时间或任务更新时间，不修改任务状态或版本。标题预览最多 160 Unicode code
points，截短时标记 titleTruncated；不返回完整标题、description 或 version。完整
任务内容继续使用既有详情接口。节点按 `(createdAt,id)` 排序，前置及阻塞 ID 数组
按 ID 排序；空图和空数组使用 `[]`，时间使用 UTC。边由 dependsOn 表示。

一个成功图最多包含 1,000 节点、5,000 边。快照内先获取精确数量；超过任一上限
返回 `409 graph_limit_exceeded`，error.details 包含 `nodeCount`、`edgeCount`、
`maxNodes`、`maxEdges`，不包含 taskIds，不返回部分图。缺失 project 仍为 404。
数据库、取消和事务完成失败优先于暂存的缺失或超限结果，不得被降格成 404/409。
计数、依赖、ready 与 summary 必须来自同一次快照，即使读取期间有并发写入。

错误响应统一包含 `error.code`、`error.message`、`error.requestId`，必要时包含
`error.details.taskIds` 中按 ID 排序的阻塞 task ID。HTTP 状态与错误分类如下：

| HTTP 状态 | `error.code` | 场景 |
|---|---|---|
| `400` | `invalid_input` | 格式、字段、分页参数、依赖引用、自身或重复依赖不合法 |
| `401` | `unauthenticated` | 会话或个人访问令牌缺失、失效或已撤销 |
| `403` | `forbidden` | 普通成员执行管理员操作，或 Cookie 会话写请求来源不符合要求 |
| `404` | `not_found` | 路径资源缺失、当前用户不是项目成员或 task 不属于指定 project |
| `405` | `method_not_allowed` | 已知路径使用不支持的方法，并返回 `Allow` |
| `409` | `version_conflict` | 任务元数据、生命周期或项目设置的期望版本过期 |
| `409` | `invalid_transition` | 生命周期操作的当前状态不符合要求 |
| `409` | `dependency_cycle` | 候选依赖图成环 |
| `409` | `dependency_unsatisfied` | 领取、完成或元数据候选违反前置完成规则 |
| `409` | `graph_limit_exceeded` | 完整图超过节点或边上限，返回精确数量和支持上限 |
| `500` | `internal_error` | 内部或持久化操作失败，响应不泄露数据库连接信息或 SQL |

## 运行与范围

服务默认监听 `127.0.0.1`，继续只接受数值 loopback 监听地址；认证对全部业务
请求强制启用。启动必须配置公开 origin、UniAuth 服务地址、App ID、App Secret
和同 origin 的 callback URL，要求见[鉴权需求](daynight-auth.md)，操作配置由
[部署指南](../../deployment/localhost/README.md)拥有。生产公开 origin 使用 HTTPS；
受控 HTTP 测试例外与 UniAuth loopback HTTP 例外分别显式配置，不提供关闭鉴权模式。
`/healthz` 和 `/readyz` 公开可读，后者仅检查数据库可用性，不检查用户登录或 UniAuth。
[本地 Docker Compose 部署](../../deployment/localhost/README.md)提供一条命令构建
并启动内嵌任务看板、API 和 PostgreSQL，等待数据库及完整 readiness 转发路径健康后返回。
页面和 API 共用服务 origin，宿主机 HTTP 端口只发布到 `127.0.0.1`，数据库不发布宿主机端口；容器重建和普通停止必须
保留项目与任务，删除持久卷须使用单独的显式命令。
项目、任务及身份/成员状态由 PostgreSQL 持久化，启动失败必须非零退出。
附件扩展将文件内容保存到独立存储，其非原子性边界由附件需求记录。
关闭时停止接收新请求，在有界期限内排空请求，再关闭数据库连接。

本文的任务管理接口范围不包含自动任务执行、PR 关联、review 调度、跨 project
依赖或 project/task 删除接口。完整图读取由本文定义，浏览器页面及内嵌交付要求由
[看板需求](daynight-web.md)拥有，包括独立附件阅读页的 GET/HEAD 深链接。页面只交付
既有 index，完整附件清单与文件读取继续使用原接口；路径校验、未知路径和方法拒绝
遵守[附件阅读要求](daynight-task-attachments.md#独立页面完整阅读)。现有分页接口继续
遵循本文的快照边界。后续扩展必须保留现有 task 身份、
状态约束、事务原子性和错误语义。源码构建需要先安装固定的 Node/pnpm workspace
依赖并构建真实页面资源；缺少资源必须构建失败，不能交付占位页面。容器验收使用独立
[dev-ci 部署](../../deployment/dev-ci/README.md)，正常、失败或取消均定向清理本次
资源，日常部署的项目与任务数据保持不变。

## 验收要求

| 编号 | 必须提供的证据 |
|---|---|
| V1 | Project 和 task 的 HTTP 创建、列表、读取、更新可跨服务重启持久化 |
| V2 | 无效引用、跨 project、自身、重复和间接环被拒绝且无部分写入 |
| V3 | 同 project 并发反向依赖最多一个成功，不同 project 的写入可独立推进 |
| V4 | 四状态及前态受限生命周期、全部错误前态、PATCH status 拒绝、同版本领取/撤回竞争和依赖更新与领取竞争保持状态约束 |
| V5 | 并发相同版本更新最多一个实际变更成功；过期版本冲突；无变化更新保持版本 |
| V6 | 分页、筛选、派生字段和错误映射与本文一致，空列表不掩盖读取失败 |
| V7 | 真实 PostgreSQL 测试覆盖事务回滚、迁移失败、并发写入和一致读取；取消和关闭有明确结果 |
| V8 | `go vet`、race 测试和 `go-cov --ci` 通过；覆盖率总计严格大于 90%、每包至少 85%、每函数至少 80%，保留关键代码块检查 |
| V9 | 覆盖率不足或 PostgreSQL 不可用使 Go 检查失败；[CI 路由](../../README.md#ci-selection)选择的检查必须成功，未选中的检查必须为 `skipped`，main push 保留全量门禁 |
| V10 | 请求日志可按 request ID 关联业务和存储失败，记录错误类别、组件和阶段，敏感值不进入日志 |

实际进程与安装 CLI 验收通过固定的真实 UniAuth gateway 夹具取得浏览器会话与 PAT，
再执行原有 V1–V10 业务场景。受控外部 provider 响应与真实上游登录具有不同证据
范围；认证配置、私有夹具元数据和凭据不得写入公开产物。

覆盖率是验证门禁，不能替代 V2–V7 的行为证据。测试归属及工具版本固定规则由
[设计](../design/daynight-server.md)定义。
