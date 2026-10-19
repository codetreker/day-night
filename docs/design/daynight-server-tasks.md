# daynight-server 实现任务

状态：T1–T6 的实现与验证均已完成。CI 发布逐次执行的覆盖率和进程验收证据。

本文拥有实现任务的编号、状态、前置关系、改动范围和完成条件。
[需求](../spec/daynight-server.md)拥有行为及 V1–V10 验收要求，
[设计](daynight-server.md)拥有分层、存储、并发和运行机制，
[决策记录](../../.agents/notes/implemented/architecture/2026-10-19-daynight-server-task-design.md)
拥有取舍及重新评估条件。任务完成时同步状态和验证结果；行为或机制改变时先更新对应文档。

## 任务顺序

| 编号 | 任务 | 状态 | 前置 | 主要交付 |
|---|---|---|---|---|
| [T1](#t1) | Go 服务运行与验证基础 | 已完成 | 无 | 独立模块、配置、生命周期、数据库测试环境、覆盖率门禁 |
| [T2](#t2) | PostgreSQL 存储与事务 | 已完成 | T1 | 迁移、表与查询、锁、原子写入、一致读取 |
| [T3](#t3) | Project 用例与 HTTP 接口 | 已完成 | T2 | 仓库地址登记、project 创建及查询、公共 HTTP 结构 |
| [T4](#t4) | Task 领域用例 | 已完成 | T2 | 依赖图、状态规则、版本和原子更新 |
| [T5](#t5) | Task HTTP 接口 | 已完成 | T3、T4 | task 路由、输入语义、错误、分页与筛选 |
| [T6](#t6) | 完整服务验收 | 已完成 | T5 | 实际进程、重启持久化、跨层并发与失败证据、完整 CI |

T3 与 T4 在 T2 完成后可以并行。每项任务交付自身的行为测试；T6 负责已实现组件
组合后的验证。共享文件由修改该文件的任务协调，避免并行覆盖公共类型或测试设施。

## 共同完成条件

每项任务都必须交付范围内的实现、所属 package 的有效测试及受影响文档。
失败路径保留错误链；测试所需 PostgreSQL 不可用时必须使必需检查失败。
覆盖率阈值、原有 CLI 检查及行为验收要求持续有效。

任务完成依据可观察行为和实际检查结果。测试归属必须使相应 package 获得覆盖率，
不能仅靠跨包端到端调用声称存储或 service 已覆盖。证据应说明命令、结果和必要的
运行条件；失败测试须定位原因后处理。

<a id="t1"></a>
## T1：Go 服务运行与验证基础

状态：已完成。前置：无。

验证：`bash scripts/check.sh` 通过构建、vet、race 和覆盖率门禁；36 项 Go 测试与
9 项覆盖率检查测试通过，原始覆盖率为 152/154 条语句（98.70%），没有产品代码
排除项。Store 与 server package 为 100%，可执行程序 package 为 88.2%。
[PR #21](https://github.com/codetreker/daynight/pull/21) 已合并，
[合并后 CI](https://github.com/codetreker/daynight/actions/runs/39230127916) 的
Go、三个原生 CLI 平台及汇总检查全部通过。

### 范围与文件归属

负责 `packages/daynight-server/` 的 `go.mod`、`go.sum`、
`cmd/daynight-server/`、运行配置与生命周期代码、测试环境启动设施及
`.go-cov.toml`。建立 `api/`、`internal/server/`、`internal/service/`、
`internal/core/` 和 `internal/core/store/` 的职责及调用方向。
同步根目录 `README.md`、`AGENTS.md` 和模块使用说明中的 Go 模块归属及验证命令。
负责 Go 基础检查的 CI 接入，保留现有各平台 CLI 检查及汇总门禁。

### 实现内容

- 实现独立可执行程序及严格启动配置；HTTP 默认使用 `127.0.0.1`，拒绝非 loopback
  监听地址。PostgreSQL 连接信息必须明确提供。
- 使用实现时仍受支持的稳定 Go 和 PostgreSQL 版本，并固定工具链与数据库测试版本。
- 建立 `pgxpool`、数据库连接校验、根 context、请求取消和有界关闭顺序；启动失败
  非零退出并释放已创建资源，收到关闭信号后停止接受请求、排空并取消剩余请求。
- 提供 `slog` 结构化日志、request ID 生成或校验基础，以及连接信息和认证材料脱敏。
- 提供真实 PostgreSQL 的本地测试环境和隔离数据设施，任务临时资源放在 `.tmp/`。
- 固定 `go-cov` 到 `d6caf2759e330b48d69a543695e37002a48feb1d`，执行 `go vet`、
  race 测试和 `go-cov --ci`；阈值为总计严格大于 90%、每包至少 85%、每函数至少 80%，保留 critical
  代码块阻断。在同一原始 profile 上按语句数验证严格总计门槛，恰好 90% 失败；
  工具安装、配置及测试命令可从模块说明复现。

### 完成条件

- 构建出的程序可以连接隔离 PostgreSQL，并只在配置允许的本机地址监听。
- 非法监听配置、缺失配置、连接失败均有明确诊断和非零退出；日志不包含敏感连接值。
- 实际请求取消能传入下层 context；关闭时间有界，连接池和监听资源可再次使用。
- 本地和 CI 使用相同的覆盖率规则；受控降低覆盖率或停止 PostgreSQL 会使必需检查
  失败，原有 CLI 检查仍为汇总成功的必要条件。

<a id="t2"></a>
## T2：PostgreSQL 存储与事务

状态：已完成。前置：T1。

验证：完整构建、vet、race 与覆盖率门禁通过；76 项 Go 测试和 9 项覆盖率检查测试
通过。原始覆盖率为 330/332 条语句（99.40%），store/server package 为 100%。
真实 PostgreSQL 验证包含迁移、锁与取消、部分写入回滚和交错快照读取。
[PR #22](https://github.com/codetreker/daynight/pull/22) 已合并，
[合并后 CI](https://github.com/codetreker/daynight/actions/runs/39234431020) 全部通过。

### 范围与文件归属

负责 `internal/core/store/` 的具体 PostgreSQL 实现、内嵌 SQL 迁移和该 package
内的集成测试，同时建立存储读写所需的共享 `core.Project`、`core.Task` 数据模型。
提供 T3、T4 所需的事务、查询和持久化操作；领域策略归 service，后续任务复用这些
模型并实现对应规则。
负责迁移与启动的连接处衔接，修改 T1 的生命周期入口时协调共享文件。

### 实现内容

- 建立 project、task、依赖表和索引，应用主键、非空、正版本、合法状态及非自身依赖
  约束；表不建立 foreign key。版本和 UTC 时间采用设计规定的数据库表示。
- 实现空库迁移、版本和校验值验证。迁移使用固定的专用 `pgxpool.Conn` 取得
  session advisory lock，在同一物理连接上跨越全部迁移事务并最终显式解锁。
- 解锁清理使用独立有界 context；无法确认解锁时关闭物理连接，再释放 pool 资源。
  迁移失败回滚当前迁移，保留已成功版本并暴露原始失败与清理失败。
- 提供 `READ COMMITTED` 写事务及 project `FOR UPDATE` 锁。等待锁结束后用独立
  查询读取最新任务和依赖；task 字段、全部边、版本与更新时间在一次事务中提交。
- 提供 project 范围读取、前置及下游查询、候选图可达性查询，以及按
  `(createdAt, id)` 排序的 keyset 查询。单次响应的资源、依赖和派生数据使用一致快照。
- 查询、锁等待、提交及回滚保持 context 和错误链；持久化失败不能转为空列表或缺失资源。

### 完成条件

- 真实 PostgreSQL 测试覆盖空库、重复启动、版本或校验值不符、迁移部分失败；两个
  实例竞争锁且跨越多个迁移时仍顺序执行，结束后锁和专用连接均已清理。
- 两连接的屏障测试证明 project 锁串行化同 project 写入，锁后查询可见最新提交，
  不同 project 的写入可以独立推进。
- 在 task 元数据和至少一条依赖已写入后注入受控数据库失败，断言 task、全部边、
  版本和更新时间均恢复为提交前值。
- 将单次读取与另一连接的提交更新交错，结果只能是完整的提交前或提交后状态。
- 取消真实锁等待和查询等待后操作及时结束，无迟到写入；事务及连接可回收，后续
  请求可以取得相同锁。测试位于 store package 并计入其覆盖率。

<a id="t3"></a>
## T3：Project 用例与 HTTP 接口

状态：已完成。前置：T2。

验证：完整构建、vet、race 与覆盖率门禁通过；125 项 Go 测试和 9 项覆盖率检查
测试通过。原始覆盖率为 608/610 条语句（99.67%），store/service/server package
均为 100%。独立 PostgreSQL 检查验证了分页、事务完成失败优先级及请求取消。
[PR #23](https://github.com/codetreker/daynight/pull/23) 已合并，
[合并后 CI](https://github.com/codetreker/daynight/actions/runs/39238313197) 全部通过。

### 范围与文件归属

复用 T2 的 `core.Project` 模型，负责 `internal/service/` 的 project 用例、
`api/` 的 project 及公共 DTO、`internal/server/` 的 project 路由与公共 HTTP 处理。
负责公共错误、request ID、JSON 输入处理和分页编码；与并行的 T4 协调共享声明。

### 实现内容

- 实现 project 创建、列表和读取用例，应用生成 UUID，返回数据库生成的 UTC 时间。
- 仅作地址语法校验：接受 HTTPS、SSH URL、SCP 风格地址，拒绝控制字符、HTTPS
  userinfo、嵌入密码、query 和 fragment；SSH 用户名允许保存，多个 project 可以登记同一 repo。
- 实现 `POST /api/v1/projects`、`GET /api/v1/projects` 和
  `GET /api/v1/projects/{projectId}`；创建返回 `201`、资源体和 `Location`。
- 建立请求大小限制、严格 JSON 及不可写字段校验、稳定错误码和 request ID 响应；
  数据库失败映射为脱敏的内部错误，服务日志保留可定位的组件、阶段和错误类别。
- 实现 `limit` 默认 50、范围 1–100、不透明 cursor、稳定 keyset 排序和
  `items`/`nextCursor` 响应；公共 cursor 校验支持 T5 的类型、project、筛选范围绑定。

### 完成条件

- HTTP 和 service 测试覆盖成功创建、持久化读取、空列表、多页排序及末页空 cursor。
- 各种合法地址均可登记，非法及含认证材料的地址被拒绝；同 repo 的两个 project
  保持独立身份。注册过程没有网络请求、Git 或子进程执行、CLI 配置修改。
- 无效 JSON、字段、ID 和分页参数得到正确输入错误，缺失 project 为 `404`，受控
  数据库故障为 `500`，失败不伪装为成功列表。
- 请求与业务、存储日志通过 request ID 关联，敏感值不进入响应或日志；service 的
  真实数据库测试位于其 package，HTTP 测试覆盖公共处理的调用方结果。

<a id="t4"></a>
## T4：Task 领域用例

状态：已完成。前置：T2。

验证：完整构建、vet、race 与覆盖率门禁通过；163 项 Go 测试和 9 项覆盖率检查
测试通过。原始覆盖率为 815/817 条语句（99.76%），service 的 348/348 条语句
全部覆盖。真实数据库竞争验证反向边、前置重开/下游开始、相同版本、取消和回滚。
[PR #24](https://github.com/codetreker/daynight/pull/24) 已合并，
[PR CI](https://github.com/codetreker/daynight/actions/runs/39239970446) 全部通过。

### 范围与文件归属

复用 T2 的 `core.Task` 模型，负责 `internal/service/` 的 task 创建、列表、读取、
更新用例和所属 package 测试。使用 T2 的具体 store，在 service 内编排事务和校验。
不修改 T3 负责的公共 HTTP 类型；需要补充查询时与 store 归属协调。

### 实现内容

- 创建固定为 `todo`，支持描述和完整前置集合；校验缺失、跨 project、自身、重复
  依赖及直接或间接环。候选图校验考虑移除旧边再加入完整新依赖的结果。
- 所有 task 写入先锁 project，再读取并校验完整候选状态。开始、完成和修改活跃或
  已完成任务依赖时要求前置完成；直接下游活跃或已完成时拒绝重开前置。
- 更新要求期望版本；过期请求即使值未变也冲突。匹配版本的语义空更新保持版本和
  时间，依赖顺序变化为空更新；真实字段或依赖变化只递增一次版本并原子提交。
- 保留省略字段的值，拒绝显式 `null`，空描述和空依赖集合具有明确清空语义。
  从一致读取中返回排序后的 `dependsOn`、`blockedBy` 及派生的 `ready`。
- project 范围查询保持隔离；依赖或前置状态变化不自动改变下游状态、版本和时间。

### 完成条件

- 正常操作及每类拒绝路径都有测试，拒绝后字段、边、版本和时间保持不变；错误含
  稳定分类及适用的阻塞 task ID。
- 真实 PostgreSQL 并发测试证明反向依赖最多一个成功，前置重开与下游开始保持规则，
  相同版本更新最多一次实际变化，旧版本空更新也冲突。
- 测试覆盖完整依赖替换、直接及间接环、各状态转换、活跃任务改依赖、语义空更新
  和派生字段；读写失败保留 cause。用例测试位于 service package 并计入其覆盖率。

<a id="t5"></a>
## T5：Task HTTP 接口

状态：已完成。前置：T3、T4。

验证：完整构建、vet、race 与覆盖率门禁通过；234 项 Go 测试和 9 项覆盖率检查
测试通过。原始覆盖率为 995/997 条语句（99.80%）；server/service/store 均为
100%。HTTP 测试覆盖字段语义、状态/依赖拒绝、版本、隔离、分页、故障、取消及日志。
[PR #26](https://github.com/codetreker/daynight/pull/26) 已合并，
[合并后 CI](https://github.com/codetreker/daynight/actions/runs/39248492304) 全部通过。

### 范围与文件归属

负责 `api/` 的 task DTO、`internal/server/` 的 task 路由、转换及 HTTP 测试。
复用 T3 的公共错误、JSON 和分页机制，通过 T4 用例访问业务数据。

### 实现内容

- 实现 project 下的 task `POST`、列表 `GET`、单项 `GET` 和 `PATCH` 路由；创建
  返回 `201` 与 `Location`，读取和更新返回 `200`。
- 严格处理创建及 PATCH 输入；PATCH 必须有 `version` 和至少一个可修改字段。
  只有版本的请求返回 `400`，提供可修改字段但值未变时执行语义空更新规则。
- 区分省略、`null` 和空集合，拒绝未知、只读字段及非法状态；将输入、缺失、版本、
  环和状态错误分别映射为约定的 `400`、`404`、`409`，内部失败为 `500`。
- task 列表支持 `status`、`ready` 交集筛选。cursor 绑定列表类型、project 及规范化
  筛选；在数据库中筛选后分页，`nextCursor` 依据筛选后剩余记录产生。
- 请求取消贯穿用例和存储；断开请求不继续写响应，响应内资源和派生字段来自一致状态。

### 完成条件

- HTTP 测试覆盖各路由成功与失败结果、全部 PATCH 字段语义、错误明细和 request ID。
- 不存在 project 的 task 列表为 `404`；其他 project 的 task ID 也为 `404`，依赖
  错误不返回其他 project 内容。
- 分页测试覆盖空页、末页、同时间戳排序、筛选交集及 `ready`，拒绝 cursor 的类型、
  project 或筛选条件错用；不能先取页再删除 blocked 项。
- 用真实 PostgreSQL 验证 HTTP 响应的一致派生数据和取消后的无迟到写入；读取故障
  明确失败，响应及日志不泄露 SQL、连接信息或认证材料。

<a id="t6"></a>
## T6：完整服务验收

状态：已完成。前置：T5。

验证：完整构建、vet、race 与覆盖率门禁通过；247 项 Go 测试和 9 项覆盖率检查
测试通过。原始覆盖率为 995/997 条语句（99.80%）。实际 race binary 通过
12 个场景组，19 个子进程全部回收，12 个 schema 及全部所属 session 清理完成。
不可用 PostgreSQL 使完整命令以非零状态失败。
[验收报告](../research/daynight-server-acceptance.md)记录 V1–V10 的证据归属与 CI 产物。

### 范围与文件归属

负责实际构建产物的 HTTP 验收设施、完整 CI 汇总及交付文档。协调已有 package 测试
补足跨层证据，同步需求、设计、决策记录、模块说明和根 README 的交付状态。

### 完成条件

- 运行实际可执行程序及真实 PostgreSQL，经 HTTP 创建 project/task、修改依赖和
  状态，正常停止并重新启动后读取相同持久化资源，给出 V1–V10 全部证据。
- 跨层验证并发反向边、重开与开始竞争、版本竞争、部分写入失败回滚、请求取消及
  一致读取；结果与各 package 的行为断言一致。
- 验证并发迁移启动、迁移失败资源清理、启动失败非零退出、有界关闭、请求关联日志
  及敏感值脱敏。清理任务产生的进程、连接、数据库和临时资源。
- `go vet`、race 测试、`go-cov --ci` 及覆盖率门槛实际通过；受控覆盖率不足和数据库
  不可用均阻断检查，CI 汇总同时要求 Go 检查与原有各平台 CLI 检查通过。
- 文档只在对应行为和验证交付后标记为已实现；任务状态与实际完成证据一致。

## 非阻塞跟进

以下是验收设施的局部强化，不属于 T1–T6 的剩余交付条件：

| 编号 | 状态 | 内容 | 当前界限 |
|---|---|---|---|
| F1 | 未排期 | 在 fixture 完成初始版本/证据设置前就登记 cleanup | 成功及已覆盖的失败场景均已验证清理；加强更早的 setup 失败路径 |
| F2 | 未排期 | 用 listener 已关闭的屏障替换 graceful-signal 场景中的 40 ms 等待 | 现有进程测试与 runtime 单元测试共同验证 drain；加强该进程场景自身的时序证明 |
