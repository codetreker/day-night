# Project 与 Task 客户端需求

状态：共享配置与 HTTP 基础已实现；仓库关联、命令入口与完整联调待完成。
本文定义交付后的必需行为；当前可用命令仍以
[仓库 README](../../README.md)为准。

`daynight project` 和 `daynight task` 是 `daynight-server` 的客户端入口，供开发者
在终端管理项目及任务，也为脚本提供完整 JSON 查询结果。它们与 `review`、`update`
并列，使用现有 HTTP API。本文拥有命令、配置、仓库关联和输出要求；服务的数据、
状态约束及错误语义由[服务需求](daynight-server.md)拥有，机制见
[客户端设计](../design/daynight-project-task.md)，实现分解见
[交付任务](../design/daynight-project-task-tasks.md)，决策见
[方案决策](../../.agents/notes/implemented/architecture/2026-10-20-project-task-cli-design.md)。

## PT1. 范围与命令边界

交付包含 project 创建、列表和详情，以及 project 内 task 的创建、列表、详情、更新
和完整图查询。CLI 复用现有服务接口，不新增 server API、数据库字段、project 唯一
约束、认证方式或任务执行能力。允许配置地址不改变服务现有的本机访问边界。

顶层、命令组和操作帮助必须先于配置加载、Git、文件写入和网络访问执行。裸
`project`、`task` 显示各自帮助。新增业务依赖不得成为 review、自更新、帮助或版本
的启动前提；这些命令继续遵守[客户端需求](daynight.md)及各自的业务要求。

## PT2. 服务配置

全局配置继续使用既有 `~/.daynight/config.yml`，增加 `serverUrl`：

```yaml
serverUrl: http://127.0.0.1:8787
```

该值是包含协议、主机和可选端口的 HTTP 或 HTTPS 服务根地址；省略端口使用协议的
默认端口。允许结尾根斜线，拒绝凭据、非根路径、query、fragment、空值及错误类型。
客户端添加 `/api/v1`。缺失或无效值必须说明配置文件、字段和修正方式。

仅使用 project/task 时，上述配置即足够，不要求 `repositories`、review 路径、
SQLite、GitHub CLI 或 Copilot。共享层读取严格 YAML 并识别已登记的顶层字段；各
命令只校验和解析自己的配置投影。project/task 不因无关 review 字段的业务校验失败
而拒绝执行，review 也不要求有效的 `serverUrl`。YAML 语法错误、重复 key 和未知
顶层字段仍需暴露。既有 review 配置、状态格式和路径保持原有语义。

## PT3. 仓库地址正规化

未显式指定 project 的 task 操作，必须定位调用目录所属的 Git worktree 根目录，并
读取经 Git `insteadOf` 展开后的 `origin` fetch 地址。从子目录调用使用同一根目录；
linked worktree 分别保存自身关联，submodule 使用自身的根目录及 origin。非 Git
目录、bare repository、缺少 origin 或读取失败应报告具体原因。

当前 origin 和服务返回的 `repoUrl` 必须使用同一正规化规则比较。普通 hosted repo
的 HTTPS、默认 `git` 用户 SSH URL 和 SCP 写法在默认端口下视为相同：

```text
https://github.com/codetreker/day-night.git
ssh://git@github.com/codetreker/day-night.git
git@github.com:codetreker/day-night.git

→ github.com/codetreker/day-night
```

正规化将主机名转小写，移除仓库路径末尾斜线；仅在移除后仍有非空仓库路径时移除一个
`.git` 后缀，单独的 `.git` 路径保留为字面值。保留任意层级及路径大小写。不得根据
未经验证的 provider 规则将路径转小写。非默认端口、特殊 SSH
用户、缺省 SSH 用户、SSH alias 的主机名和显式相对路径必须保留有意义的区别；
不得展开任意 SSH 配置或猜测 alias 的真实主机。百分号编码保持原样，不把编码路径
解码为另一仓库标识。精确算法与边界 fixture 由设计拥有。

## PT4. Project 选择

所有 task 操作接受可选的 `--project <id>`，按以下顺序选定目标：

| 条件 | 必需行为 |
|---|---|
| 显式传 `--project` | 使用指定 project，在 Git 仓库之外也可执行；不读取或改写自动发现关联 |
| 本地关联的 server、repo 与当前值一致 | 按 project ID 读取远端详情，校验 repo 关联后使用 |
| 本地关联缺失或 server、repo 已变化 | 遍历服务完整 project 列表进行 discover |
| 缓存 project 返回 404，或详情 repo 不再匹配 | 重新 discover 一次 |
| discover 无匹配 | 报 `Project does not exist`，执行失败 |
| discover 唯一匹配 | 保存关联后使用该 project |
| discover 多个匹配 | 报匹配歧义，列出匹配 ID 并提示显式 `--project` |

discover 必须读取全部分页才可判定匹配数量。唯一匹配保存前也必须按 ID 读取并验证
目标详情；读取失败按实际错误处理。网络、超时、500、无效 JSON 和响应结构错误
不得触发 rediscover 或被解释为 project 不存在。

有效缓存的绑定在同 repo 后来增加其他 project 时保持稳定；每次按 ID 校验即可。
显式 `--project` 仅决定本次调用，不改变该绑定。首次 discover、缓存失效及重新发现
均不得在目标不明确时执行 task 写入。GET 校验与后续 task 请求之间仍可能发生服务
侧变化，最终结果由 task API 的原子校验决定。

## PT5. 仓库本地关联

仓库专属信息放在 worktree 根目录 `.daynight/` 中，关联保存为
`.daynight/project.yml`：

```yaml
serverUrl: http://127.0.0.1:8787
repoIdentity: github.com/codetreker/day-night
projectId: 8cb7af59-133e-4dc4-a9e6-c8a4b2429762
```

首次保存时确保根 `.gitignore` 包含 `/.daynight/` 且忽略规则实际生效，保留已有
内容。关联记录中的 server 地址与正规化仓库标识共同界定 project ID 的适用范围。
本地状态使用锁及原子替换写入；锁被有效持有时立即报告竞争失败，不等待或自动
重试；仅有证据证明原持有者已死亡时才可回收。损坏数据、锁失败、ignore 规则无法
生效和写入失败均是操作失败，不可伪装成未发现。远端 task 写操作必须晚于所需本地
准备成功。

## PT6. Project 命令

```bash
daynight project create --name "Day Night" --repo https://github.com/codetreker/day-night.git
daynight project list
daynight project list --json
daynight project show <project-id>
daynight project show <project-id> --json
```

创建必须显式提供名称和 repo 地址，将原始 repo 地址提交给服务；登记 project 不
修改当前仓库关联、不 clone 仓库、不启动 review。列表查询配置 server 中的全部
project，不按当前仓库筛选。详情使用显式 ID，以上操作均可在 Git 仓库之外执行。

## PT7. Task 命令与更新语义

```bash
daynight task create --title "实现登录" --description "支持 OAuth 登录"
daynight task create --title "实现登录页面" --depends-on <task-id>
daynight task list
daynight task list --ready
daynight task list --status in_progress
daynight task show <task-id>
daynight task update <task-id> --title "新的标题"
daynight task update <task-id> --description ""
daynight task update <task-id> --status in_progress
daynight task update <task-id> --status done
daynight task update <task-id> --depends-on <task-a> --depends-on <task-b>
daynight task update <task-id> --clear-dependencies
daynight task update <task-id> --status done --if-version 3
daynight task graph
```

上述命令均接受 `--project <id>`。`list`、`show`、`graph` 接受 `--json`。

创建必需非空标题，可选描述和重复的 `--depends-on`；省略描述及依赖分别使用服务
规定的空字符串和空集合，新 task 总为 `todo`。列表支持单个 `--status` 与 `--ready`，
两者按 AND 组合；状态值为 `todo`、`in_progress`、`done`。详情按选定 project
和 task ID 查询。

更新至少提供标题、描述、状态或依赖中的一个字段。省略字段表示保持，空描述表示
清空描述。出现 `--depends-on` 时替换完整前置集合；`--clear-dependencies` 清空
集合，两者不能同时出现。CLI 不合并旧依赖、不去重或修正无效引用；服务负责验证
依赖、状态约束、环和跨 project 引用。拒绝结果必须保留服务错误码与相关 task ID。

未传 `--if-version` 时，CLI 先读取 task 的当前 `version`，再将该版本与更新字段
一起提交。显式指定时，使用该正整数作为期望版本，不用最新版本覆盖它。版本范围为
`1..9223372036854775807`，客户端必须保留完整精度，HTTP 与 JSON 输出仍使用数字。冲突必须
报告失败，不自动读取新版本重试。无变化更新、版本递增和时间戳遵循服务语义。

`graph` 使用现有完整图接口，呈现节点状态、依赖、阻塞和汇总；标题预览、快照
边界、节点和边上限均继承服务要求。超限时报告数量及上限，不返回部分图。

## PT8. 输出、分页与错误

普通查询提供可读结果；列表自动遍历全部分页，仅在完整读取、结构验证成功后输出
结果。`--json` 将详情输出为一个资源对象、列表输出为完整资源数组、图输出为完整
图响应对象，并以换行结束。资源字段保持服务 API 的名称和类型，不插入诊断文字。
写操作成功后输出服务确认的资源 ID 及结果；服务未确认成功时不得输出成功结果。

结果写入 stdout，错误及诊断写入 stderr。成功退出 `0`，参数错误退出 `2`，操作
失败退出 `1`。诊断须标识操作及相关 project/task；服务错误保留 `code`、`message`、
`requestId` 和有关 details。不得输出凭据、请求环境或数据库细节。

## PT9. 请求生命周期

执行命令必须具有覆盖 Git、缓存验证、全部分页、本地锁及 HTTP 的共享总期限，
HTTP 请求还须有单次期限；读取和累积响应必须具有字节上限。客户端机制常量由设计
定义，不增加公开配置项或 CLI 参数。总期限、单次期限、响应或累计字节超限均需
明确失败，不能静默截断、返回部分成功或换用猜测目标。这些是客户端资源限制，
不改变服务分页、图或业务约束。

超时、连接失败、取消、解析失败和服务拒绝必须区分；取消或预算用尽后停止翻页、
本地保存与后续写入。准备阶段超限不得保存发现结果或发送 task mutation。写请求
不自动重试；响应丢失、超限或取消发生于请求发送后时说明结果未确认，不能声称
远端没有写入。失败列表不输出看似完整的部分结果，失败缓存读取不使用猜测目标。

## PT10. 验收要求

| 编号 | 必须提供的证据 |
|---|---|
| V1 | 仅有 `serverUrl` 的配置可执行服务命令；review 与服务配置分别校验，缺失或业务值无效的 `serverUrl` 不影响 review、帮助、版本及 update 的依赖隔离 |
| V2 | 从真实 Git 仓库根目录、子目录、linked worktree 和 submodule 正确读取有效 origin；缺少仓库或 origin 时错误可辨 |
| V3 | HTTPS、SSH、SCP 等价 fixture 得到同一身份；单独 `.git` 路径有可比较身份，路径大小写、自定义端口、特殊用户、alias 和显式相对路径不被误合并 |
| V4 | discover 跨全部 project 页区分零、唯一、多匹配；后续页失败不保存关联、不输出成功、不执行 task 写入 |
| V5 | 首次唯一发现创建正确元数据和有效 ignore；并发写入不损坏记录，本地失败发生于 task mutation 之前 |
| V6 | 缓存每次通过远端详情验证，后增重复 project 不改变有效绑定；server 或 origin 任一变化均重新发现；404 或 repo 不符仅重新发现一次，网络及结构错误保持原因 |
| V7 | 显式 `--project` 在 Git 外可执行且不改自动绑定；显式 ID 缺失、无权限或读取失败不进入自动发现 |
| V8 | project 创建、列表、详情与 task 创建、筛选、详情、更新、图查询通过真实 Go server 联调；所有写入遵循现有服务规则 |
| V9 | 更新覆盖读取版本、显式期望版本、并发冲突、空描述、依赖替换及清空；服务拒绝保留 task ID 且没有隐式重试 |
| V10 | 多页查询与 `--json` 仅完整成功后输出；图保持完整响应字段并正确报告超限，stdout 可直接由 JSON parser 读取 |
| V11 | 单次期限、持续推进 cursor 耗尽总期限、单响应和累计字节超限、锁竞争、用户取消、错误响应、无效 JSON、损坏缓存及磁盘失败分别给出正确 stderr 和退出码；超限无部分输出或后续副作用，写响应未确认不产生虚假失败确定性 |
| V12 | CLI 既有 `pnpm typecheck`、`pnpm test`、`pnpm build` 及相关安装验收通过；Linux、macOS、Windows 的 Git、锁及文件替换有原生证据 |

已实现的配置和 HTTP 基础覆盖相应模块验证；V1–V12 仍约束完整 CLI 交付。仓库
关联、命令、真实服务联调与原生证据的实际状态见任务清单，不能仅凭基础模块测试
认定命令或完整验收已完成。
