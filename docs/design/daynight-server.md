# Daynight Server 架构设计

状态：Go 服务、事务存储、project/task 用例与 HTTP 接口、覆盖率门槛和完整进程
验收均已实现；Go 二进制内嵌看板并与 API 同源交付。

`daynight-server` 是独立的 Go 服务，为本机 CLI 和内部程序提供 project、task
及任务依赖管理。行为要求由[需求文档](../spec/daynight-server.md)拥有；架构选择及
重新评估条件由[决策记录](../../.agents/notes/implemented/architecture/2026-10-19-daynight-server-task-design.md)
拥有。决策记录标记的是已采用的设计，不表示服务已经交付。
[任务拆分](daynight-server-tasks.md)记录执行任务的范围、依赖、状态和验收条件。
[只读看板设计](daynight-web.md)定义完整图快照接口、浏览器页面和内嵌静态资源
交付；图 API 保留本文的领域与事务结构，不改变现有分页读取的一致性承诺。

已采用的[附件架构](daynight-task-attachments.md)提供独立的 bucket/path 文件存储；
通用本地存储与启动接入已实现，单文件附件接口仍待完成；[附件需求](../spec/daynight-task-attachments.md)
拥有行为与已知问题，[附件任务拆分](daynight-task-attachments-tasks.md)提供实施范围
及 Daynight 进度入口。
现有 PostgreSQL task 事务规则不扩展为文件与元数据的原子提交保证。

现有 `packages/daynight/` TypeScript CLI、YAML 配置和 SQLite review 状态继续独立
运行。服务不读取或迁移这些状态；注册 project 也不启动现有 review 协调器。

[预定义属性设计](daynight-task-properties.md)为完整 task 提供固定结构的 PR
引用，服务端已沿用本文的事务与版本机制实现存储、迁移和 HTTP 操作。其
[需求](../spec/daynight-task-properties.md)及[实施任务](daynight-task-properties-tasks.md)
拥有扩展行为与 CLI/web 的后续状态。

## 完整图读取

`Tasks.Graph` 复用既有具体 store 与只读 `ReadSnapshot`：先读取 project，随后获取
精确节点和边数量，检查 1,000/5,000 上限，再读取轻量图节点并折叠统计。core 的
`GraphTask`、`TaskGraphSummary`、`TaskGraph` 与 HTTP DTO 分离；store 的 SQL
直接截取 160 code points 的标题预览，不加载 description 或完整标题。

Project、计数、依赖及 ready 都来自同一次 `REPEATABLE READ`。服务层的缺失和
超限 Fault 等事务成功收尾后才返回，操作或清理失败仍优先。HTTP 拒绝全部非空
query，返回 no-store，并沿用既有 requestId 和结构化错误机制。具体响应与拒绝
要求由[服务端需求](../spec/daynight-server.md#完整任务图)拥有；浏览器图投影由
[看板设计](daynight-web.md#图投影与统计)拥有，不进入 store 或服务端领域状态。

## 目录与调用方向

服务位于 `packages/daynight-server/`，使用独立 `go.mod` 和可执行程序：

```text
packages/daynight-server/
├── go.mod
├── cmd/daynight-server/main.go
├── api/
└── internal/
    ├── server/
    ├── service/
    ├── webui/
    │   └── dist/                 生成的真实页面与资源，不提交
    └── core/
        ├── project.go
        ├── task.go
        └── store/
            └── migrations/
```

`cmd/daynight-server` 解析启动配置并组装依赖。`api` 拥有 HTTP 请求、响应和错误
结构；`internal/server` 使用标准库 `net/http` 处理路由、JSON、请求大小限制、
HTTP 错误映射和服务生命周期。`internal/service` 拥有 project/task 用例、业务
校验与事务编排。`internal/core` 拥有领域模型；`internal/core/store` 使用具体的
`pgx`/`pgxpool` 类型实现 PostgreSQL 查询、事务和迁移。`internal/webui` 拥有
`go:embed` 资源及页面/资源响应，server 在既有 mux 精确注册路由。静态处理不经过
service/store；请求仍只经过一次现有日志包装。HTML、图及最新详情为 no-store，
哈希资源为 immutable，缺失资源不回退 HTML。

调用方向为 `server → service → core/store`。传输层将 API DTO 转换为 service
参数，core 不依赖 HTTP，store 不决定状态转换或依赖规则。事务内查询所需的数据、
加锁和持久化操作由 store 提供，是否接受候选变更由 service 决定。现有关系型数据只有 PostgreSQL 一个实现，
不为测试另外定义空泛的 `Store` 接口或模拟存储实现。附件的字节存储接口由其独立
架构拥有，不替代这里的具体 PostgreSQL store。

独立模块允许服务拥有自己的 Go/PostgreSQL 生命周期，避免将数据库事务接入现有
客户端的 review 命令。`cmd/` 与 `internal/` 的职责遵循
[Go 服务项目布局建议](https://go.dev/doc/modules/layout#server-project)。

## 领域模型与存储结构

所有资源 ID 使用应用生成的 UUID，HTTP 将其作为不透明字符串处理。时间由数据库
生成，存为 `timestamptz`，API 输出 UTC RFC 3339。任务版本使用正整数，初始值为 1。

| 对象 | 字段与含义 |
|---|---|
| Project | `id`、非空 `name`、`repoUrl`、`createdAt`、`updatedAt` |
| Task | `id`、`projectId`、非空 `title`、`description`、`status`、具体 `properties`、`version`、`createdAt`、`updatedAt` |
| TaskDependency | `projectId`、`taskId`、`dependsOnTaskId` |

`TaskDependency` 的方向是“`taskId` 依赖 `dependsOnTaskId`”。project 拥有任务及依赖
图；不同 project 可以关联相同仓库地址，`repoUrl` 不作为 project 唯一键。当前 API
没有修改 project 仓库或删除资源的操作。

使用 `projects`、`tasks`、`task_dependencies` 三张表。`tasks.properties` 用 text
保存固定属性 DTO 的序列化 JSON；属性不增加关联表，完整 task 同行读写，图查询
保持显式精简投影。主键分别为 `id`、`id`、
`(project_id, task_id, depends_on_task_id)`。数据库使用非空、状态枚举检查、正版本
检查、非自身依赖检查及主键唯一性保证可局部表达的约束。索引支持以下访问：

- project 按 `(created_at, id)` 列表；
- task 按 `(project_id, created_at, id)` 列表及按状态筛选；
- 依赖按 `(project_id, task_id)` 查询前置任务；
- 依赖按 `(project_id, depends_on_task_id)` 查询直接下游任务。

表不建立 foreign key。引用存在性、同 project 限制和图规则由获得 project 写锁后的
service 写入路径校验；所有写入都必须经过该路径。没有删除 API，使引用不会因资源
删除失效。未来若引入删除或其他数据库写入者，必须同时设计引用维护方式。

## 仓库地址注册

创建 project 接受 HTTPS、SSH URL 和 scp 风格 Git 地址，例如：

```text
https://git.example.com/team/repo.git
ssh://git@git.example.com/team/repo.git
git@git.example.com:team/repo.git
```

解析器校验协议、主机及非空仓库路径等语法，拒绝控制字符、嵌入密码、HTTPS userinfo、
query 和 fragment。SSH 用户名是传输地址组成部分，可以保存；私钥、口令、token 等
认证材料不得出现在保存的地址中。地址处理不限定 GitHub 或其他 provider，不进行
网络访问、仓库存在性检查、认证验证或 clone。

`repoUrl` 保留校验后的地址写法，用于 project 关联。它不推导本地 clone 路径，也不
承担现有 CLI 的 GitHub 仓库身份归一化职责。创建接口的成功只表示注册已持久化。

## 状态与依赖不变量

任务状态为 `todo`、`in_progress`、`done`。创建任务固定使用 `todo`，允许同时提交
`dependsOn`；状态变更通过更新接口完成。任务状态可以向前或向后修改，但每次写入
都必须满足以下条件：

- 依赖只能指向同 project 中已经存在的任务；拒绝自身依赖、重复 ID、缺失任务、跨
  project 引用和有向环。
- `in_progress` 和 `done` 任务的所有直接前置任务必须为 `done`。
- 给 `in_progress` 或 `done` 任务增加未完成前置任务时拒绝整个更新。
- 将 `done` 任务改为 `todo` 或 `in_progress` 时，只要有直接下游任务处于
  `in_progress` 或 `done`，就拒绝整个更新。

检查直接下游足以保持状态不变量：每个活跃或已完成任务都要求其直接前置完成。
不需要隐式回退下游任务，也不根据状态变更自动开始其他任务。依赖检查限制状态
写入，不能仅把非法状态显示为 blocked 后仍允许保存。

读取任务时派生两个字段：`blockedBy` 是按 ID 排序的、状态尚未达到 `done` 的直接
前置任务 ID；`ready` 等于 `status == todo` 且 `blockedBy` 为空。`dependsOn` 返回
按 ID 排序的全部直接前置任务 ID。这些字段由当前持久化依赖和状态计算，不另存
可漂移的计数或 DAG 缓存。

## 写事务与并发

所有 task 创建及更新，包括只有标题或描述变化的更新，都遵循相同事务协议：

1. 以 `READ COMMITTED` 开启事务，用 `SELECT ... FOR UPDATE` 查找并锁定 project
   行；不存在时返回 `not_found`。
2. 在获得锁后执行新的查询，读取目标任务、现有依赖和校验所需任务状态。更新检查
   请求中的 `version`，与当前任务版本不一致则返回 `version_conflict`。
3. 构造字段和完整依赖集的候选状态，校验引用、图和状态规则。
4. 原子写入任务和依赖集合；存在真实变更时，将版本加 1，并更新 `updatedAt`。
5. 提交后返回资源；失败回滚，原始错误链保留至顶层错误处理。

同 project 的 task 写入由 project 行锁串行化，不同 project 可以并行。获得锁与读取
任务不能合并为一个依赖同一旧快照的 SQL 语句：等待锁结束后，后续查询需要看到刚
提交的 project 内写入。该机制依赖 PostgreSQL 在 `READ COMMITTED` 下为每条命令
取得新快照的语义，见[事务隔离文档](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED)
及[行锁文档](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)。

写锁同时覆盖“检查再写入”，所以并发添加 `A → B` 和 `B → A`、并发重开前置任务
及开始下游任务都必须有一个请求根据另一事务的结果重新校验。版本检查解决同一任务
的过期客户端覆盖问题；project 锁解决跨任务图和状态的不变量，两者职责不同。

更新 `dependsOn` 是替换完整直接前置集合。环检测使用递归可达性查询或等价的有界
遍历，候选图必须先移除该任务旧的出边，再加入完整候选出边。对每条候选边
`task → predecessor`，若 predecessor 能在候选图中到达 task，则拒绝。校验基于本次
锁内读取的数据，不依赖请求前查询或进程缓存。

PATCH 的语义空操作仍检查版本及输入，返回当前资源，保持 `version` 和 `updatedAt`
不变。任意真实字段、状态或依赖集合变化只增加一次版本；依赖顺序变化不算真实变更。
业务校验先生成候选变更计划，完成全部检查后才执行写入。预期拒绝保留为业务结果，
callback 不执行写入并正常结束；只有外层事务成功后才返回业务 Fault，提交或清理失败
优先暴露为内部失败。没有删除 API，因此锁前确认过的 project 存在性不会由合法 API
操作撤回。任务和边不能分次提交。响应资源在同一事务快照内构造，提交成功后再返回，避免提交后
分次重读混合不同状态。事务内不执行网络访问、Git、子进程或其他外部操作。

该设计以同 project 写入吞吐量换取明确的串行规则。采用 `SERIALIZABLE` 可以提供
另一种并发控制，但还需要全操作重试及冲突响应策略；project 已经是依赖范围，因此
以 project 行锁组织写入更直接。若出现单 project 写入瓶颈，再根据观测重新评估。

## HTTP API

接口使用 `/api/v1` 和 JSON：

| 方法与路径 | 操作 |
|---|---|
| `POST /api/v1/projects` | 创建 project |
| `GET /api/v1/projects` | 分页列出 project |
| `GET /api/v1/projects/{projectId}` | 获取 project |
| `POST /api/v1/projects/{projectId}/tasks` | 创建 `todo` task |
| `GET /api/v1/projects/{projectId}/tasks` | 分页列出 task |
| `GET /api/v1/projects/{projectId}/tasks/{taskId}` | 获取 task |
| `PATCH /api/v1/projects/{projectId}/tasks/{taskId}` | 原子更新 task 及依赖 |

创建 project 的输入为 `name` 和 `repoUrl`。创建 task 的输入为 `title`、可省略的
`description`、`dependsOn` 与 `properties`；省略描述表示空字符串，省略依赖和
PR 引用表示空数组。创建成功
返回 `201`、资源体和对应资源的 `Location`；读取及更新成功返回 `200`。

PATCH 必须提交期望的 `version`，并至少提供 `title`、`description`、`status`、
`dependsOn` 或一个已定义属性。只有 `version` 或空 `properties` 的请求返回
`invalid_input`；
提供字段但值未变的请求采用前述语义空操作规则。例如：

```json
{
  "version": 3,
  "title": "Implement task API",
  "status": "todo",
  "dependsOn": ["f3fc4136-4422-4b01-9864-0c721798b03a"]
}
```

省略可更新字段表示保持原值；`description: ""` 清空描述，`dependsOn: []` 清空
依赖，`properties.pullRequests: []` 清空 PR 引用。属性数组按序比较并整体替换，
具体记录只有字符串 `url` 和 `title`；内容不做业务校验。显式 `null`、嵌套未知或
重复字段、不合理的类型及非法枚举均为输入错误。`id`、
`projectId`、创建时间及更新时间不可由调用者写入。任务返回结构包含模型字段及
`dependsOn`、`blockedBy`、`ready`。

Task 路径先确认指定 project 存在，再在其范围内查找资源。Project 不存在时，
包括 task 列表在内的所有子路径均返回 `not_found`，不能返回成功的空列表。其他
project 中存在的 `taskId` 仍返回 `not_found`。依赖输入中的缺失或跨 project ID
作为非法依赖返回输入错误，不读取或返回其他 project 的任务内容。

## 列表与读取一致性

两个列表接口接受 `limit` 和不透明 `cursor`。`limit` 默认 50，范围为 1 至 100，
使用 `(createdAt, id)` 升序 keyset 分页；响应为 `items` 和 `nextCursor`，没有
下一页时后者为 `null`。
task 列表另外接受单个 `status` 枚举和 `ready` 布尔筛选，两个筛选同时出现时取交集。

cursor 编码最后一项的位置、资源类型、project 路径范围及规范化筛选条件。解码时
校验格式和范围，拒绝将 project 列表 cursor 用于 task 列表，或在修改筛选后复用。
cursor 不承担身份授权或加密职责。列表不承诺跨多次请求维持同一数据库快照；新增
或更新后的任务可能影响后续页中按筛选条件可见的集合。

单次 GET 或列表的任务状态、依赖与派生字段必须来自同一个数据库快照。实现可以在
同一 SQL 语句中聚合，或在只读 `REPEATABLE READ` 事务内完成分页、依赖和状态查询。
`ready` 筛选在数据库中使用同一状态条件，不能取一页后在应用中删掉 blocked 任务。
分页边界应用于筛选后的结果，`nextCursor` 根据该结果中是否还有记录产生。

## 错误与诊断

service 返回可识别的领域错误；server 负责唯一的 HTTP 映射。错误响应统一使用
`error` 对象，包含稳定的 `code`、可读 `message` 和 `requestId`，必要时用
`details` 返回阻塞 task ID；不包含 SQL、连接串、堆栈或认证材料。

| 错误码 | HTTP | 情形 |
|---|---|---|
| `invalid_input` | `400` | JSON、字段、分页、地址或依赖引用非法，含自身及重复依赖 |
| `not_found` | `404` | 指定 project 或其范围内的 task 不存在 |
| `method_not_allowed` | `405` | 已知路径不支持该方法，`Allow` 提供允许的方法 |
| `version_conflict` | `409` | PATCH 期望版本过期 |
| `dependency_cycle` | `409` | 候选依赖产生环 |
| `dependency_unsatisfied` | `409` | 状态或依赖修改违反前置完成规则 |
| `internal_error` | `500` | 数据库或其他未分类服务端失败 |

HTTP 只映射 service 的类型化业务错误；其他失败统一作为内部错误。读取缺失资源时，
service 在 snapshot callback 内保留缺失结果但返回成功，待只读事务正常结束后才生成
`not_found`。如果事务提交或清理失败，内部错误优先，不能因错误链含缺失标记而返回
`404`。数据库错误不能转换为空列表、成功响应或领域资源不存在。service/store 保留 cause
链，顶层按错误类别映射；请求取消通过 context 传递，已断开的请求不再尝试写响应。
事务提交错误必须作为失败暴露，不能宣称写入成功或自动重复整个非幂等创建请求。

采用标准库 `slog` 结构化日志，每个请求生成或校验 `requestId`。涉及已解析资源时
记录 `projectId`、`taskId`，同时记录组件、阶段、错误类型和经脱敏的 cause。
已知业务拒绝使用同名 `error_code` 和 cause，例如 `dependency_unsatisfied`；取消、
数据库和网络失败分类优先，不能被错误链中的业务标记掩盖。脱敏必须覆盖数据库连接
信息、请求体及仓库地址中的认证材料；不直接记录原始
driver 错误或完整请求体。成功日志提供方法、路由模板、状态和耗时。

诊断服务失败时，先以响应 `requestId` 定位日志，再沿组件和阶段定位失败；数据库
问题另外检查迁移版本及 PostgreSQL 日志。验收应通过非法状态、版本冲突和受控
数据库故障确认错误码、日志关联和脱敏内容，不能只检查健康请求的输出。

## 启动、迁移与关闭

启动配置明确提供 PostgreSQL 连接信息和 `DAYNIGHT_STORAGE_ROOT`；HTTP 默认监听
`127.0.0.1`。LocalStorage 在打开数据库和监听前准备根目录，要求可写且区分大小写。
运行时以 `Dependencies` 向装配层提供数据库与文件存储，并在启动失败或 HTTP
排空结束后关闭已取得的文件根句柄。批准范围为本机
CLI 和内部程序调用，服务只接受 loopback 监听地址。远程认证、授权及对外部署需要
独立设计，当前接口中的 project ID 不作为认证凭据。

[本地 Compose 部署](../../deployment/localhost/README.md)将 PostgreSQL、Go 服务与
TCP 网关组合启动，Go 服务同时提供内嵌只读看板和 JSON API。生产 Dockerfile 以
仓库根目录为 context，在 Node 24/pnpm 10.34.5 阶段构建并发布真实 UI，在 Go
1.27.2 阶段内嵌资源，最终仅复制二进制至非 root Alpine 运行镜像。专属 ignore
纳入锁文件、workspace manifests、`patches/` 声明补丁和实际源码，排除宿主
依赖、临时文件及生成资源。网关拥有网络命名空间，Go 服务加入该命名空间并继续监听
`127.0.0.1:8787`；网关监听容器端口 `80`，仅发布到宿主机 `127.0.0.1`。
转发不解析 HTTP，响应、请求大小限制和错误语义继续由服务处理。数据库通过内部
Compose 网络访问，PostgreSQL 18 数据卷挂到 `/var/lib/postgresql`。
服务等待数据库健康后启动，由既有流程执行迁移；两条 HTTP 健康检查分别通过
服务回环端口和网关访问已有的 project 列表接口。网关配置或网络拓扑变化时整体
重建容器并保留数据卷。部署脚本每次重新构建并整体重建容器，用相同命令完成启动、
源码更新及转发恢复；数据卷持续保留。网关意外单独重启时，Docker 不会自动重启
共享命名空间的服务，健康检查会暴露转发失败，需要重新运行脚本恢复。
[部署决策](../../.agents/notes/implemented/architecture/2026-10-20-localhost-compose.md)
记录拓扑选择及运行限制。[内嵌交付决策](../../.agents/notes/implemented/architecture/2026-10-20-embedded-dashboard-deployment.md)
记录构建与隔离验收结构。独立 `deployment/dev-ci` 复用同一 Dockerfile 和 nginx
配置，采用唯一项目身份、随机 loopback 端口和专用数据库卷，按 run ID 有界清理，
日常 localhost 数据与资源不作为测试前置。

进程启动时创建 `pgxpool` 并验证数据库连接，然后从 pool 获取并固定一条专用
`pgxpool.Conn`。该连接取得 PostgreSQL session-level advisory migration lock，
并在同一物理连接上完成版本读取、校验和全部内嵌 SQL 迁移。当前迁移先建立 project，
再建立 task 与依赖表；应用记录必须是内嵌迁移的有序前缀。锁必须跨越整个迁移
序列，不能使用会在单个迁移提交时释放的 transaction-level advisory lock，也不能
通过 pool 的任意连接分别取得和释放锁。

每个迁移在专用连接上的事务中连同版本记录一起提交；失败回滚当前迁移并退出，
保留已成功的早先版本。版本未知、迁移内容与已记录校验值不一致或锁获取超时都
明确失败。成功与失败路径都先在锁所属连接上显式解锁，再将连接归还 pool；若无法
确认解锁，则关闭该物理连接使 session 结束，不能把可能持锁的连接归还 pool。清理
使用独立且有界的 context，避免已取消的启动 context 跳过解锁。

服务启动期间只支持当前迁移序列中已有的版本，不在业务读取时判断或修补旧格式。
所有迁移成功且数据库可用之后才开始接受 HTTP 请求；启动失败释放已创建的 pool
及监听资源。没有依赖后台任务去补齐图状态或引用。

请求 context 贯穿 server、service 和 store，数据库查询及锁等待遵守取消和截止
时间。服务关闭时停止接受新连接，在有界时间内等待请求，随后取消剩余请求并关闭
连接池。`main` 拥有根 context、HTTP server 和 pool 的关闭顺序；请求代码只拥有
自身事务。错误回滚及资源释放不得覆盖原始失败；若清理也失败，保留两者的错误信息。

## 验证设计

测试放在所属 Go package 中。领域纯函数可直接测试，store 与 service 使用真实
PostgreSQL 实例及隔离数据库或 schema，验证 SQL、锁和事务行为。数据库环境缺失
应使要求数据库的验证明确失败，不以跳过测试获得通过。`go-cov` 不提供
`-coverpkg`，跨包端到端调用不自动计入被调用包的覆盖率，因此 store/service 的
数据库测试必须位于各自的被测 package。

覆盖范围包括正常资源操作、非法字段和地址、同 project 限制、自身及重复依赖、环、
完整依赖替换、状态门禁、重开拒绝、版本冲突、语义空更新、失败回滚，以及一致的
`dependsOn`/`blockedBy`/`ready`。并发测试使用协调屏障观察真实锁等待，证明并发
反向依赖和前置重开/下游开始最终仍保持不变量，同时证明不同 project 可以并行。

HTTP 测试验证路由、DTO、错误映射、project 范围查找、分页筛选和 cursor 范围。
整体验收运行实际构建的服务，通过 HTTP 创建 project/task，停止并重新启动服务后
再读取已提交资源，证明跨重启持久化。关键数据库验证采用以下可观察场景：

- 回滚：在已更新 task 元数据并写入至少一条依赖后，通过测试数据库中的受控失败
  使后续写入出错，断言 task、全部依赖、版本和更新时间均恢复为提交前状态。仅在
  写入前拒绝非法输入不能替代这项证据。
- 一致读取：用同步屏障交错一次 GET/列表读取与另一连接的已提交更新，断言响应只
  对应完整的提交前或提交后状态，不能混合状态、依赖及派生字段。
- 取消：令真实请求等待 project 行锁或数据库查询后取消请求，验证等待终止、没有
  迟到写入，事务及连接可回收，后续请求仍能取得锁。运行时取消测试使用独立观察
  连接，在 `pg_stat_activity` 中匹配唯一标记 SQL、当前数据库和非观察连接 PID，
  并确认 `active`、`Timeout/PgSleep`，再触发客户端取消或 drain；保留原有错误类型、
  关闭期限和连接健康断言。
- 迁移：验证空数据库、重复启动，以及两个实例竞争同一锁并跨越多个迁移的行为；
  在部分迁移失败时核对版本和数据，确认锁及专用连接均已清理。

生命周期测试还覆盖连接失败、有界关闭和日志脱敏。测试不以模拟 store 替代数据库
行为；最终交付必须给出需求 V1–V10 的全部验收证据。

实现交付的验证包含 `go vet`、启用 race 的测试及 `go-cov --ci`。覆盖率配置位于 Go
模块内的 `.go-cov.toml`，总计门槛严格大于 90%、每包至少 85%、每函数至少 80%，critical
路径保持默认阻断。`go-cov` 的 total 配置仍使用 90；同一原始 coverage profile
再按唯一代码块的语句数执行 `covered * 10 > total * 9` 精确检查，拒绝零语句和
无效报告。恰好 90% 必须失败，显示为 `90.0%` 但实际高于 90% 的结果按原始值判断。
工具固定到提交 `d6caf2759e330b48d69a543695e37002a48feb1d`；该提交包含
排除项分母修正，不能用缺少该修正的 `v0.1.3` 代替。配置及门槛语义见
[固定版本 README](https://github.com/codetreker/go-cov/blob/d6caf2759e330b48d69a543695e37002a48feb1d/README.md#configuration)。

覆盖率不替代并发、回滚和调用方行为断言。PR 按[仓库 CI 路由](../../README.md#ci-selection)
选择受影响模块，main push 执行全量应用检查。最终 `checks` 只接受所有前置 job 的
`success` 或 `skipped`，失败、取消及其他结果使汇总失败；未选中的 job 为 `skipped`。
Go、web、CLI 和 shell completion 各自的检查内容及门槛保持。
统一验证入口为模块内的 `bash scripts/check.sh`，要求显式设置
`DAYNIGHT_TEST_DATABASE_URL`。干净 checkout 先从根目录 frozen 安装 Node 24/pnpm
10.34.5 依赖，Go 检查在任何 build/vet/race 前调用共享 `pnpm web:build` 发布
资源；缺少工具、依赖或真实产物直接失败。命令 package 的 TestMain 每次构建新的 race binary，
通过真实 HTTP、PostgreSQL、信号和进程重启执行验收，不复用旧的可执行文件。

PT-T5 的安装 CLI 验收复用此 command-package fixture，新增
`installed_cli_project_task_workflow` 场景，通过 `PT.V*` 要求编号对应 CLI 的真实
project/task 操作、依赖推进、重启持久化及版本竞争。Node 编排入口在 Go
覆盖率 gate 前准备一次安装，将同一产物用于 Go 场景及随后预算探针；原有 go-cov
参数、race、critical 与 strict raw profile 检查保持原义。预算探针运行在 Go 默认
10 分钟 test timer 之外；公开安装命令的两个期限场景通过测试侧 preload 使用
1 秒单次和 3 秒总期限，生产默认 30 秒/5 分钟由测试单独断言。四个字节场景保留
真实 128 MiB/256 MiB 限制及精确边界和 +1 字节配对。原有 Go 作业仍为 20 分钟。
独立实际进程场景在其顶层测试内最多四个并发，各自保留 schema、进程、数据库
屏障及清理；顶层测试间的全局环境修改仍串行。原始服务场景不被 CLI 场景替换，细节见
[安装联调决策](../../.agents/notes/implemented/testing/2026-10-20-installed-project-task-acceptance.md)及
[CLI 设计](daynight-project-task.md#验证与交付证据)。根目录
`.tmp/project-task-service-evidence.json` 记录安装身份、Go/预算结果与清理，实际状态
仍由 CLI 任务清单拥有。CI
发布 `.tmp/acceptance-evidence.json` 和同次 `.tmp/coverage.out`；前者记录源版本、
binary hash、场景及资源清理，CI 要求 checkout 干净且 Git revision 与 `GITHUB_SHA`
一致。V1–V10 的证据归属与 receipt 解释见
[服务端验证说明](../../packages/daynight-server/README.md#built-process-acceptance-and-ci-evidence)；
逐次运行结果随对应 PR 与 CI 保存。

运行前失效项目内的 Go 测试结果缓存，确保数据库状态
变化不能被缓存报告掩盖；Go 与 web 两个 job 通过 `setup-go` 复用以 server `go.sum`
为依赖身份的编译与模块缓存。真实业务和跨层验收证据随对应任务交付。
