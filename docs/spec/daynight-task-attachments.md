# Task 附件需求

状态：通用本地存储、附件元数据、文件 HTTP/预览接口、CLI 附件命令、Web 管理
界面和部署持久卷已实现，包含停止写入后的 PG/附件目录配套备份恢复验证。
跨层验收采用真实服务上的安装 CLI 与生产浏览器组合，实施进度由 Daynight 维护。
本文拥有附件的产品行为与 FA1–FA12 要求；
[架构](../design/daynight-task-attachments.md)拥有模块、接口和运行机制，
[任务拆分](../design/daynight-task-attachments-tasks.md)拥有实施范围、依赖与完成条件，
并提供 Daynight 进度入口。
[决策记录](../../.agents/notes/implemented/architecture/2026-10-21-task-attachment-storage-design.md)
记录范围和取舍。各组件的实际验证结果归属对应源码、PR 与 CI。

[鉴权需求](daynight-auth.md)规划附件请求继承项目成员权限；
[架构](../design/daynight-auth.md)和[任务拆分](../design/daynight-auth-tasks.md)拥有
认证与授权机制及交付条件。该扩展尚未实现。本文的可信同源 HTML、普通 iframe、
相对资源及键盘交互在鉴权接入后继续保留，单文件操作和 K1 边界继续有效。

## 目标与范围

Task 可以保存设计文档、架构文档、图片及 HTML mockup 等附件。文件内容由独立
存储模块保存，元数据存在 PostgreSQL。Web 可以管理、预览和下载，CLI 可以管理
并直接读取内容。现有 project/task、依赖图和 review 行为保持原有职责。

| 编号 | 要求 |
|---|---|
| FA1 | 存储模块以 bucket 和真实相对路径提供写入、读取、删除的抽象接口；当前交付本地磁盘实现，接口可以用于其他文件用途。 |
| FA2 | 每次上传、覆盖或删除一个文件；同 task、同完整相对路径直接覆盖。保留路径结构，目录从文件路径生成。 |
| FA3 | PostgreSQL 保存 task 归属、相对路径、内容类型、大小和时间；附件操作不修改 task 的状态、依赖、version 或 updatedAt。 |
| FA4 | 通过作用域明确的 HTTP 接口流式上传、读取和删除单个文件；写入结果和错误明确返回。 |
| FA5 | 文件元数据支持完整遍历的游标分页，Web 和 CLI 根据路径构造目录树。 |
| FA6 | Web 在同一服务 origin 管理附件，通过固定 task 预览路径显示内容并保持相对资源引用；HTML 按可信项目代码在 iframe 中执行。 |
| FA7 | CLI 提供 task attachment put/list/read/remove，复用现有服务配置和 project 选择。 |
| FA8 | CLI read 输出原始字节；二进制传输、输出背压、取消、超时和错误传播有明确语义。 |
| FA9 | 本地附件根目录有明确配置和持久化部署；测试使用独立目录、数据库及卷，清理仅影响本次资源。 |
| FA10 | 文件与 PG 元数据不原子是已接受的已知问题；当前不实现一致性协调、补偿或恢复，普通操作错误仍明确暴露。 |
| FA11 | 通过实际存储、真实 PG、安装 CLI 和生产浏览器验证范围内行为，保留现有验证门槛和证据归属。 |
| FA12 | 交付范围不包含目录上传、整目录替换、历史版本、唯一对象 key、预览会话、独立预览 origin、Service Worker 或后台对账系统。 |

## 文件寻址与目录

附件标识为 `(taskId, path)`，不另设客户端必须使用的附件 ID。`path` 是 task 内
完整的相对路径，例如 `docs/design.md`。相同名称位于不同目录时可以共存。

路径区分大小写，使用 `/` 分段，保存原始合法 Unicode 拼写。拒绝绝对路径、空段、
`.`、`..`、反斜杠、控制字符和非法 UTF-8；URL 按段编码并仅解码一次。非法路径
必须拒绝，不能自动清理成其他有效路径后执行写入或删除。

目录不单独登记，没有空目录操作。最后一个文件删除后，相应目录从展示树中消失。
文件和目录不得占据同一位置：存在文件 `docs` 时，不能创建 `docs/design.md`；
存在 `docs/design.md` 时，不能用文件覆盖 `docs`。命名规则的本地实现必须与目标
文件系统实际行为一致；LocalStorage 准备根目录时验证大小写能力，不支持时拒绝
启动，不能默默合并不同逻辑文件。

任务附件使用固定 bucket `task-attachments`，存储路径为
`<canonicalTaskId>/<path>`。客户端路径不包含 bucket 或物理分片。当前本地布局
直接映射 bucket 和存储路径；内部 shard 可以由后端改变物理映射，不能成为 API
或 PG 元数据中的另一种路径。没有 bucket 管理 API 或用户可配置 shard 机制。

## 元数据与修改

附件元数据包含 project、task、path、contentType、sizeBytes、createdAt、updatedAt。
数据库以 `(task_id, path)` 为主键，不保存派生的 bucket、存储 key 或历史记录。
覆盖保留创建时间并更新文件属性和更新时间；删除后重建使用新的创建时间。

内容大小来自实际保存结果。上传端提供内容类型，无法识别时使用
`application/octet-stream`。内容读取响应的长度必须来自本次实际打开的存储对象，
不能用可能过期的 PG 大小声明另一份内容的长度。

所有 task 状态均可操作附件。附件变化只刷新附件区域，不改变任务图或 task 版本。
project 不存在、task 不属于该 project 或目标附件不存在时返回作用域内的 `404`。

## HTTP 操作

设 task 前缀为 `/api/v1/projects/{projectId}/tasks/{taskId}`：

| 方法与路径 | 成功行为 |
|---|---|
| `GET /attachments` | 返回元数据页和 nextCursor；空列表为 items: []。 |
| `PUT /attachments/files/{path...}` | 请求体为一个文件的原始字节；新建返回 201，覆盖返回 200，响应为文件元数据。 |
| `GET /attachments/files/{path...}` | 返回原始字节及内容类型，供下载和 CLI 读取。 |
| `DELETE /attachments/files/{path...}` | 删除指定文件，成功返回 204；缺失附件返回 404。 |
| `GET /preview/{path...}` | 以浏览器展示方式提供 task 内的指定文件和相对资源。 |

未提供上传 Content-Type 时使用 application/octet-stream；非法或重复的 MIME header
返回 400。内容 URL 的普通 query 不参与文件名，预览相对资源可保留缓存参数。

文件列表使用现有 limit/cursor、items/nextCursor 约定，按 path 的确定顺序分页；
cursor 绑定列表类型、project 和 task。分页不保证多次请求属于同一快照。
CLI 完整列表只在所有页面读取成功后输出；Web 可以保留已加载页，但不能把失败
当作文件不存在。文件读写不经过仅接受 JSON 的请求体或响应解析通道。

参数错误返回 `400 invalid_input`，资源缺失返回 `404 not_found`，文件与目录占位
冲突返回 `409 path_conflict`，存储或
PG 操作错误返回 `500`，沿用现有 code/message/requestId 错误结构。流式响应已经
开始后发生错误时终止传输并记录关联错误，不在文件末尾追加 JSON 错误或成功文字。
失败或结果未确认的写入不得自动重试。

## Web 管理与预览

Task 详情在关联 PR 之后显示文件树。上传操作选择一个文件，目标路径初始为文件名，
可修改为多层相对路径；上传 MIME 按目标路径确定，相同路径直接覆盖。点击文件可以
预览，文件同时提供下载、删除操作。修改成功后刷新附件数据与相关预览；手动刷新
发现所选文件的 `updatedAt` 改变时，内容也重新读取。多个文件独立修改、独立生效，
不承诺目录级原子更新或多文件内容快照。

列表逐页读取，续页错误保留已读取文件并明确标记结果不完整，提供重试。列表、写
操作和预览拥有独立加载与错误状态。project/task 或文件选择变化及卸载会取消过期
请求，晚到结果不能覆盖当前身份的内容。附件表单与同源 frame 中的 Esc、Tab 操作
继续遵守任务侧栏的焦点约束及关闭恢复规则。

| 类型 | 展示方式 |
|---|---|
| Markdown | CommonMark 与 GFM（含表格）渲染，原始 HTML 作为文本；按文档目录解析相对图片和链接，独立 `#fragment` 保留。 |
| 图片 | 图片展示。 |
| PDF | 浏览器 PDF 展示。 |
| 文本、JSON、源码 | 保留换行的文本展示。 |
| HTML | 普通 iframe，固定预览路径，支持其相对 CSS、JS、图片及正常脚本交互。 |
| 其他类型 | 文件信息和下载。 |

图片使用原生图片加载及错误重试；HTML/PDF 在原生 iframe 请求前检查 HEAD 可用性，
失败明确展示并可重试，不读取 HEAD 的 JSON body。原生 frame 负责后续正常资源请求。

预览入口为 `/api/v1/projects/{projectId}/tasks/{taskId}/preview/{path...}`，
不增加专用预览 token、预览会话、子域名、端口或 Service Worker。HTML 被视为
可信项目代码，运行在主站同源环境；该方案不提供上传脚本与主应用之间的权限隔离。
规划中的[鉴权需求](daynight-auth.md)在附件请求入口检查登录态和项目成员关系，
继续保留这一可信代码执行约定。

## CLI

```bash
daynight task attachment put <task-id> ./design.md --path docs/design.md
daynight task attachment list <task-id> --tree
daynight task attachment list <task-id> --json
daynight task attachment read <task-id> docs/design.md
daynight task attachment read <task-id> images/mockup.png > ./mockup.png
daynight task attachment remove <task-id> docs/design.md
```

操作均支持现有 `--project` 选择；省略时复用仓库关联。`put` 的来源必须是一个
本地普通文件，省略 `--path` 使用来源文件的 basename；打开后通过实际句柄检查
文件属性，再通过该句柄上传，不上传目录或推导目录批次。上传内容类型根据最终
目标逻辑路径的扩展名推导，未知扩展名使用 `application/octet-stream`。
`--path` 是 text 选项，接受 `--path=value`；`put/read/remove` 接受 `--` 结束选项
解析，保留前导连字符的位置路径，所有选项须放在终止符之前。
`list` 默认显示元数据，`--tree` 按目录组织，`--json` 输出完整元数据数组；tree 和
JSON 为互斥展示方式。`read` 原样输出字节，不附标签、转义、JSON 或额外换行。
错误输出 stderr，沿用成功 0、参数错误 2、操作失败 1。

传输与 stdout 必须支持二进制及背压，沿用共享取消、信号和总期限。文件内容使用
有界缓冲流，不套用元数据 JSON 的单响应和累计字节上限；元数据继续遵守原有预算。
读取途中失败时 stdout 可能已有不完整内容，必须非零退出。元数据列表的完整输出
要求不扩展为文件 read 的全量缓冲要求。stdout 的等待、取消、超时和管道关闭均须
明确结束本次拥有的输出执行，命令结束前回收辅助资源；清理失败保留原因。
原有帮助、版本和其他命令的依赖隔离继续有效，首次非空字节输出前不启动输出辅助
进程。

## 部署与已知问题

服务使用明确的本地存储根目录，在接受文件请求前检查目录可用性和写权限。正常
重建或停止保留 PG 和附件数据；dev-ci 使用独立卷，既有定向清理覆盖该卷。
备份和恢复须包含匹配的 PG 元数据与文件目录。停止服务及其他写入方后同时备份
两者；恢复到空卷时，先恢复匹配的 PG 与附件目录，再启动服务。正常停止、重启、
重建以及保留卷的 teardown 必须保留两者；显式删除卷会同时销毁元数据与附件文件。
此流程不修复备份前已存在的跨介质不一致；本次不交付自动备份系统。

**已知问题 K1：文件内容与 PG 元数据更新不具备原子性。** 文件替换或删除成功后，
数据库失败、进程退出或并发操作可能留下内容与记录不一致。普通操作错误必须返回，
写请求可能已经产生变化；不能承诺失败一定保留旧内容或自动恢复。

K1 只记录，不作为当前实施任务。当前不增加跨存储锁协议、事务协调、补偿、恢复、
状态台账、后台扫描或对账服务；也不把跨存储回滚或故障后一致性作为验收门槛。

## 验收归属

任务拆分将 FA1–FA12 映射到存储、HTTP、CLI、Web、部署和跨层验收。各组件测试
验证正常行为、路径拒绝、普通 IO 失败及错误传播。真实进程与 PostgreSQL 验证
持久性，实际安装 CLI 验证二进制字节，生产浏览器验证相对资源和可信 HTML 交互。
Go 和 Web 既有覆盖率、race 及原生 CLI 检查持续有效。

Web 前端 mockup 复用实际组件与 CSS，通过内存元数据和本地文件展示交互，不需要
Go/PG。它及本地现有浏览器探针验证前端状态、视觉和焦点。实际服务验收在原生和
生产容器两个目标上由已安装 CLI 与页面交叉读取同一 task 文件；二进制按原始字节
比较，PDF 必须在 compositor 截图中出现预期色块，HTML 相对资源通过可见交互验证。
原有图场景仍只读；仅新附件场景允许精确 task/file PUT/DELETE。JSDOM 不具备布局，
不能证明隐藏元素的浏览器焦点行为。

Go 的独立安装 CLI 旅程覆盖超过一页的附件列表、原始内容、拒绝及 requestId、同根
重启和完整 task 不变，并把附件根目录实际删除纳入清理 gate。Web 完整运行复用
一次安装产物，保留源码、tarball/entry 摘要、浏览器、生产镜像和进程/组回收证据。
组合机制与证据边界由[验收决策](../../.agents/notes/implemented/testing/2026-10-21-task-attachment-cross-layer-acceptance.md)拥有。

每份运行证据归属其测试源码、PR 和 CI；文档校验或设计审查不证明运行时已实现。
K1 的记录和范围一致性需要检查，但其修复不属于 FA11 的交付条件。
