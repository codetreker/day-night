# daynight-server 任务管理需求

状态：Go 服务、事务存储、project/task 用例与 HTTP 接口、覆盖率门槛和完整进程
验收均已实现。[服务端验证说明](../../packages/daynight-server/README.md#built-process-acceptance-and-ci-evidence)
定义验证范围、要求与测试映射和 CI 产物解释；逐次运行结果随对应 PR 与 CI 保存。

本文定义 `daynight-server` 面向本机 CLI 和内部程序的任务管理行为。
[技术设计](../design/daynight-server.md)拥有分层、存储和并发机制；
[设计决策](../../.agents/notes/implemented/architecture/2026-10-19-daynight-server-task-design.md)
记录取舍和范围。[任务拆分](../design/daynight-server-tasks.md)记录实现任务、依赖、
状态与验收条件。

[预定义属性需求](daynight-task-properties.md)扩展本文的 task 资源，PR 引用的
服务端存储、更新与迁移已实现；[架构](../design/daynight-task-properties.md)和
[实施任务](../design/daynight-task-properties-tasks.md)拥有机制及 CLI/web 的后续状态。

已采用、尚待实现的[附件需求](daynight-task-attachments.md)扩展本文的服务基线，
增加本地文件内容、PG 元数据、单文件操作和固定预览路径。其
[架构](../design/daynight-task-attachments.md)与
[任务拆分](../design/daynight-task-attachments-tasks.md)单独拥有附件机制及实施状态。

## 目标与交付范围

| 编号 | 要求 |
|---|---|
| R1 | 使用 Go 实现独立的 `daynight-server`，使用 PostgreSQL 持久化业务数据 |
| R2 | 支持创建、列表查询和读取关联一个 repo 地址的 project |
| R3 | 在 project 内支持创建、列表查询、读取和更新 task |
| R4 | task 支持同 project 内的依赖关系，任何成功提交都必须保持无环 |
| R5 | task 状态为 `todo`、`in_progress`、`done`，前置未完成时禁止开始或完成 |
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
| `createdAt`、`updatedAt` | UTC 时间，HTTP 使用 RFC 3339 格式 |

一个 project 关联一个 repo，多个 project 可以关联同一 repo。支持 HTTPS URL、
SSH URL 和 SCP 风格 SSH 地址，地址必须包含主机和仓库路径；地址登记不验证实际访问权限。
名称必须是无 NUL 的有效 UTF-8 文本。HTTPS 地址不得包含凭据，SSH 地址允许用户名，
但不得包含密码；查询参数和 fragment
不属于仓库地址。无效地址作为输入错误拒绝，地址中 SSH 用户名不作为业务身份。

当前接口只提供创建、列表查询和单项读取；创建后 `repoUrl` 不可通过 task 更新改变。

## Task 与依赖

Task 包含以下持久化字段：

| 字段 | 语义 |
|---|---|
| `id` | 服务生成的 UUID |
| `projectId` | 所属 project，创建后不可变 |
| `title` | 必填的非空 UTF-8 标题，不含 NUL |
| `description` | 不含 NUL 的 UTF-8 描述，省略时为空字符串，允许更新为空字符串 |
| `properties` | server 预定义属性；当前 `pullRequests` 为有序的 `{url, title}` 字符串记录数组，默认空数组 |
| `status` | `todo / in_progress / done`，创建时为 `todo` |
| `version` | 从 `1` 开始的正整数，每次实际变更增加一次 |
| `createdAt`、`updatedAt` | UTC 创建和最后实际变更时间 |

Task 响应还包含 `dependsOn`、`blockedBy` 和 `ready`：

- `dependsOn` 是全部直接前置 task ID，按 ID 升序返回。
- `blockedBy` 是其中尚未处于 `done` 的 task ID，按 ID 升序返回。
- `ready` 当且仅当本 task 为 `todo` 且 `blockedBy` 为空时为 `true`。

这些派生字段来自读取时的一致状态；依赖任务变化不会自动修改本 task 的 `status`、
`version` 或 `updatedAt`。`ready` 描述可开始条件，不代表已领取或已调度。

依赖 `B dependsOn A` 表示 B 开始或完成前 A 必须完成。以下输入必须拒绝：

1. 依赖自身、重复的依赖 ID、不存在的依赖。
2. 指向其他 project 的依赖。
3. 直接或间接形成环的依赖，包括并发请求分别创建反向边的情形。

## 状态与更新规则

`in_progress` 和 `done` 的 task 必须始终满足全部直接前置处于 `done`。
任何更新都对更新后的完整 task 和依赖集合进行校验，包括标题或描述更新。

| 操作 | 允许条件 |
|---|---|
| `todo → in_progress` 或 `todo → done` | 所有前置已完成 |
| `in_progress → done` | 所有前置已完成 |
| `in_progress → todo` | 允许；仍按完整候选状态校验 |
| `done → todo / in_progress` | 所有直接下游均为 `todo`；目标为 `in_progress` 时前置仍须全部完成 |
| 修改 `in_progress / done` task 的依赖 | 修改后的全部前置已完成 |
| 保持当前状态并修改字段 | 满足完整依赖与状态约束 |

拒绝操作必须返回可辨识的错误及相关阻塞 task ID，原有字段、依赖、属性、版本和时间戳均保留。
重开前置与开始下游的并发请求也必须遵守同一规则。

创建 task 可携带 `title`、`description`、`dependsOn` 和 `properties`；描述省略时
为空字符串，依赖及 `properties.pullRequests` 省略时为空数组。新 task 总是
`todo`，`status` 不属于创建输入。

PATCH 可修改 `title`、`description`、`status`、`dependsOn` 和预定义属性，并且
必须提供读取到的 `version`。省略字段表示保留，`null` 为无效输入，`dependsOn: []`
表示清空依赖。`properties.pullRequests` 按完整数组替换，`[]` 清空该属性；空
`properties` 对象本身不算可修改字段。至少提供一个可修改字段；ID、所属 project
和时间戳不可写入。
未知字段、未知状态和无效字段类型必须拒绝。

版本在事务内比较；过期版本返回冲突，即使请求期望的字段与当前值相同。
语义无变化且版本匹配的请求返回当前资源，保持版本和 `updatedAt`；
依赖数组顺序不构成变化；PR 数组顺序、重复项及各项字符串都参与属性等值比较。
实际更新字段、属性或依赖集合时，版本只增加一次。

PR 的 `url` 与 `title` 仅校验字符串类型及必填结构，保留解码后的内容，包括空
字符串、控制字符、顺序与重复项。服务不校验 URL、PR 存在性或仓库匹配；严格
拒绝嵌套未知字段、重复 key、null、缺失项和错误类型。详细行为及验收由
[属性需求](daynight-task-properties.md)拥有。

## HTTP API

| 方法 | 路径 | 结果 |
|---|---|---|
| `POST` | `/api/v1/projects` | 创建 project，返回 `201` 和资源 |
| `GET` | `/api/v1/projects` | 返回 project 分页列表 |
| `GET` | `/api/v1/projects/{projectId}` | 返回 project，缺失时 `404` |
| `POST` | `/api/v1/projects/{projectId}/tasks` | 创建 task，返回 `201` 和资源 |
| `GET` | `/api/v1/projects/{projectId}/tasks` | 返回 task 分页列表 |
| `GET` | `/api/v1/projects/{projectId}/tasks/{taskId}` | 返回 task，缺失或不属于该 project 时 `404` |
| `GET` | `/api/v1/projects/{projectId}/task-graph` | 返回同一完整快照的 project、任务图和统计 |
| `PATCH` | `/api/v1/projects/{projectId}/tasks/{taskId}` | 原子更新 task，返回 `200` 和资源 |

HTTP 创建请求使用 `Content-Type: application/json`，可附带 UTF-8 charset。请求体
最多 1 MiB，必须是单个 JSON 对象；拒绝无效 UTF-8、重复 key、字段名大小写不符、
未知或只读字段、错误类型、必填字段为 `null` 和尾随 JSON。

所有成功读取返回 `200`。Project 不存在时，其 task 子路径必须返回 `404`，
不能将空 task 列表作为不存在 project 的结果。

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
  "status": "in_progress"
}
```

列表使用 `limit`、`cursor`。`limit` 默认 `50`，允许 `1..100`；按
`createdAt ASC, id ASC` 稳定排序，返回 `items` 和 `nextCursor`，末页后者为 `null`。
Task 列表额外支持单个 `status` 和布尔 `ready` 筛选，筛选按 AND 组合。
Cursor 必须绑定列表类型、所属 project 和筛选条件，格式错误或条件不匹配返回输入错误。重复 query 参数、显式空值和未知参数也作为
输入错误拒绝；`limit` 的默认值仅用于未提供该参数。
单次响应中的 task、依赖和派生字段保持一致；多次翻页不承诺跨请求快照。

### 完整任务图

`GET /api/v1/projects/{projectId}/task-graph` 提供同一只读 `REPEATABLE READ` 快照中的
project、完整 tasks 及 summary，不使用分页或状态筛选。任何非空 query，包括未知
字段、分页/筛选字段和无效编码，均返回 `400 invalid_input`。成功、拒绝和读取错误
响应采用 `Cache-Control: no-store`；GET 同时支持 HEAD，其他方法返回 405 与 Allow。

summary 包含 `total`、`todo`、`inProgress`、`done`、`ready`、`blocked`，按不同任务
ID 计数，满足 `total = todo + inProgress + done` 和 `todo = ready + blocked`。
blocked 只计入前置未全部完成的 todo；任务的状态、版本和时间不随此次读取变化。

图节点包含 `id`、`titlePreview`、`titleTruncated`、`status`、`dependsOn`、
`blockedBy`、`ready`、`createdAt` 和 `updatedAt`。标题预览最多 160 Unicode code
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
| `404` | `not_found` | 路径资源缺失或 task 不属于指定 project |
| `405` | `method_not_allowed` | 已知路径使用不支持的方法，并返回 `Allow` |
| `409` | `version_conflict` | PATCH 版本过期 |
| `409` | `dependency_cycle` | 候选依赖图成环 |
| `409` | `dependency_unsatisfied` | 前置状态或下游状态阻止操作 |
| `409` | `graph_limit_exceeded` | 完整图超过节点或边上限，返回精确数量和支持上限 |
| `500` | `internal_error` | 内部或持久化操作失败，响应不泄露数据库连接信息或 SQL |

## 运行与范围

支持的运行边界是本机调用，默认监听 `127.0.0.1`；不提供未认证的远程监听。
跨机器访问的认证和部署是单独的功能，不能仅通过扩大监听范围绕过。
[本地 Docker Compose 部署](../../deployment/localhost/README.md)提供一条命令构建
并启动内嵌只读看板、API 和 PostgreSQL，等待数据库及完整 API 转发路径健康后返回。
页面和 API 共用服务 origin，宿主机 HTTP 端口只发布到 `127.0.0.1`，数据库不发布宿主机端口；容器重建和普通停止必须
保留项目与任务，删除持久卷须使用单独的显式命令。
本文已交付的 project/task 管理状态仅由 PostgreSQL 持久化，启动失败必须非零退出。
后续附件扩展将文件内容保存到独立存储，其非原子性边界由附件需求记录。
关闭时停止接收新请求，在有界期限内排空请求，再关闭数据库连接。

本文的任务管理接口范围不包含自动任务执行、PR 关联、review 调度、跨 project
依赖或 project/task 删除接口。完整图读取由本文定义，浏览器页面及内嵌交付要求由
[看板需求](daynight-web.md)拥有；现有分页接口继续遵循本文的快照边界。后续扩展必须保留现有 task 身份、
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
| V4 | 前置完成、下游开始、前置重开及修改依赖的顺序与并发测试保持状态约束 |
| V5 | 并发相同版本更新最多一个实际变更成功；过期版本冲突；无变化更新保持版本 |
| V6 | 分页、筛选、派生字段和错误映射与本文一致，空列表不掩盖读取失败 |
| V7 | 真实 PostgreSQL 测试覆盖事务回滚、迁移失败、并发写入和一致读取；取消和关闭有明确结果 |
| V8 | `go vet`、race 测试和 `go-cov --ci` 通过；覆盖率总计严格大于 90%、每包至少 85%、每函数至少 80%，保留关键代码块检查 |
| V9 | 覆盖率不足或 PostgreSQL 不可用使 Go 检查失败；[CI 路由](../../README.md#ci-selection)选择的检查必须成功，未选中的检查必须为 `skipped`，main push 保留全量门禁 |
| V10 | 请求日志可按 request ID 关联业务和存储失败，记录错误类别、组件和阶段，敏感值不进入日志 |

覆盖率是验证门禁，不能替代 V2–V7 的行为证据。测试归属及工具版本固定规则由
[设计](../design/daynight-server.md)定义。
