# Project 与 Task CLI 实现任务

状态：PT-T1、PT-T2 已交付；PT-T3 已实现并通过本地验证；PT-T4、PT-T5 未开始。

本文拥有任务编号、状态、依赖、文件归属和完成条件。
[需求](../spec/daynight-project-task.md)拥有 PT1–PT10 的可观察行为，
[设计](daynight-project-task.md)拥有配置、地址身份、发现与缓存和 HTTP 机制，
[决策记录](../../.agents/notes/implemented/architecture/2026-10-20-project-task-cli-design.md)
保存范围和取舍。文档记录已确认的交付目标；状态按实际实现及验证证据更新。

## 任务顺序

| 编号 | 任务 | 状态 | 前置 | 主要交付 | 对应要求 |
|---|---|---|---|---|---|
| [PT-T1](#pt-t1) 服务访问基础 | 已完成 | 无 | 共享 YAML、独立 server 配置、HTTP 客户端和错误/取消 | PT2、PT8、PT9 |
| [PT-T2](#pt-t2) 仓库关联发现 | 已完成 | PT-T1 | Git 定位、地址身份、完整发现、本地记录及忽略规则 | PT3、PT4、PT5 |
| [PT-T3](#pt-t3) Project 命令 | 已实现 | PT-T1 | create/list/show、命令登记和帮助、输出 | PT1、PT6、PT8 |
| [PT-T4](#pt-t4) Task 命令 | 未开始 | PT-T2、PT-T3 | create/list/show/update/graph、版本及依赖更新 | PT1、PT4、PT7、PT8、PT9 |
| [PT-T5](#pt-t5) 安装与服务联调验收 | 未开始 | PT-T3、PT-T4 | 实际 CLI、真实 Git、Go/PostgreSQL 联调和原生证据 | PT1–PT10 |

PT-T2 与 PT-T3 在 PT-T1 完成后可以并行，分别拥有仓库上下文与 project 命令文件。
PT-T3 完成登记后，PT-T4 再接管命令登记文件，避免并行改动入口。各任务自身交付有效
行为测试；PT-T5 验证组合后的安装产物及真实服务路径。

## 共同完成条件

所有代码、配置和文档变更在同一任务 worktree 中完成。共享文件修改前明确唯一归属，
依赖按任务安装一次；验证资源位于任务 `.tmp/`，结束时清理所属进程、数据库和目录。

需求、设计、决策及 README 的当前事实与实现保持同步；文档中的已确认状态不能作为
功能已实现的证据。代码改变按既有规则提高 CLI 包版本，保持默认 Git 身份和现有原生
检查。命令帮助不得访问配置、Git、SQLite 或网络。失败必须保留真实原因；写操作失败
不得通过自动重试重新提交。

<a id="pt-t1"></a>
## PT-T1：服务访问基础

状态：已完成。前置：无。

本地验证：`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm acceptance` 均通过；
普通测试 900 项通过，10 项平台专属测试在 Linux 上跳过，安装验收 2 项通过。配置
与 API 独立代码审查均未发现 Critical/Major。[PR #43](https://github.com/codetreker/daynight/pull/43)
已通过 review 和原生 CI 并合并；Linux、Windows 各 900 项通过，macOS 908 项通过，
各平台均通过两组安装验收。并行主线提交复用版本后的
[版本衔接修复 #45](https://github.com/codetreker/daynight/pull/45)保留严格递增规则，
[修复后的 main CI](https://github.com/codetreker/daynight/actions/runs/39393133006)全部通过。

### 文件归属与范围

负责 `packages/daynight/src/config/`、`src/api/` 和对应测试，以及现有 review 配置读取
与配置保存的衔接。共享 YAML 文档层只处理路径、解析、已知字段归属和保存协议，
业务字段由对应命令校验；保留 review 模式、配置注释、锁、原子替换和现有持久化位置。

### 完成条件

- 仅含 `serverUrl` 的配置可用于服务客户端；既有 review 配置继续直接使用。
- 非法或缺失 server 配置不成为 review、update、帮助和版本的启动前提。
- 验证 HTTP(S) origin、响应 DTO、错误信封、requestId、请求及整次命令期限与取消；
  流式计数响应字节，超过设计的单响应或累计预算时明确失败。
- 网络失败、错误内容类型、畸形 JSON 和协议不匹配均明确失败，保留可辨识原因。
- HTTP 写请求不自动重试或通过重定向重发；已有配置写入保证和 CLI 测试保持通过。

<a id="pt-t2"></a>
## PT-T2：仓库关联发现

状态：已完成。前置：PT-T1。

本地 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm acceptance` 均通过；
普通测试 1284 项通过，10 项平台专属测试在 Linux 上跳过，安装验收 2 项通过。
地址正规化、真实 Git 与关联专项分别为 155、22、50 项；独立差分探针覆盖
21,056 个地址、其中 8,190 个通过服务校验，未发现接受范围不一致。
进程取消与目录忽略问题经修复后独立复审无 Critical/Major。
[PR #47](https://github.com/codetreker/daynight/pull/47)已合并，最终提交经远端 review
批准及三个原生平台、shell 补全、Go、web 与汇总 CI 验证；Windows 进程树取消及
原生路径形式均在真实平台通过。

### 文件归属与范围

负责 `packages/daynight/src/repository/`、对应 Git/文件系统测试和本地关联 fixture。
Git 定位、普通/特殊地址比较、缓存验证、发现与保存集中于该模块，不导入 review
worktree 管理器。`.daynight/` 和忽略规则属于执行时的产品行为，开发验证只使用隔离仓库。

### 完成条件

- 从根目录、子目录、linked worktree 和 submodule 读取正确的 Git 根目录与有效 origin。
- 对来源于 origin 和 server 的地址使用同一个正规化函数；测试覆盖标准传输等价、
  多级路径、大小写、尾缀、端口、SSH 用户/alias、特殊路径和拒绝输入。
- 遍历全部 project 页后区分零、一、多个匹配；重复或不前进 cursor 明确失败。
- 缓存按 server、repo 和 project 校验；上下文变化、远端缺失或关联不符时按设计发现一次，
  网络、协议和缓存损坏错误保留；分别验证 server 与 origin 改变会触发新发现。
  后增同 repo project 不改变已验证绑定。
- 使用锁和原子文件替换保存记录，保留根 `.gitignore` 既有内容并确保根目录忽略规则生效。
  锁竞争立即失败；非普通文件、符号链接及权限失败明确报错，本地失败发生在远端任务写入之前。
- 显式 project 选择无需 Git 和本地目录，且不重写原有自动发现关联。

<a id="pt-t3"></a>
## PT-T3：Project 命令

状态：已实现。前置：PT-T1。

本地 typecheck、1395 项测试、build 和 2 组安装验收通过。Bash 4.2、Bash 5.2、
zsh 5.9 各 68 个真实 Tab 场景及未初始化 compinit 的拒绝检查共 205 项通过，
补全期间没有调用 CLI/Node。实际编译入口的受控 HTTP 证明创建只提交一次、UUID
和时间精度保留、完整分页 JSON 与续页失败 stdout 为空；真实 Go 服务联调仍由
PT-T5 验证。长名称放大填充问题经线性完整输出修复，独立复审无 Critical/Major。

### 文件归属与范围

负责 `packages/daynight/src/commands/project/`、对应测试，并在交付期间独占
`src/cli/commands.ts` 的 project 登记及根帮助衔接；同时拥有所需的共享语法必填
text 选项、静态补全及实际 shell 验收衔接。共享 server 执行层、配置取消信号和
服务文本规则保证 project 操作独立加载并保留合法值。使用现有 API 创建、列举和读取 project，
`create` 明确接受名称及 repo，列表覆盖完整分页，详情使用明确 ID。

### 完成条件

- 裸组及各级帮助不触发业务依赖；参数错误与操作错误使用既有退出规则。
- 实际编译 CLI 完成 create/list/show，并在明确 ID/地址情况下支持仓库之外调用。
- 机器输出保持完整 JSON；续页失败不输出部分成功数组，文本错误与诊断进入 stderr。
- 根命令登记、review/update 的帮助与操作保持独立，项目创建仍由 server 负责地址校验。

<a id="pt-t4"></a>
## PT-T4：Task 命令

状态：未开始。前置：PT-T2、PT-T3。

### 文件归属与范围

负责 `packages/daynight/src/commands/task/` 和对应测试；PT-T3 完成后接管
`src/cli/commands.ts` 的 task 登记。将仓库关联模块与已有 create/list/show/update/graph
HTTP 用例组合；project/task 业务规则继续由 Go 服务持有。

### 完成条件

- 所有 task 操作接受可选 `--project`，默认发现并使用当前仓库对应的 project。
- 创建、详情、状态/ready 筛选、完整图和 JSON 输出与需求一致。
- 更新支持字段保留、清空描述、完整替换依赖和显式清空；读版本后 PATCH，或使用
  `--if-version` 指定预期版本，不能在冲突后自动获取新版本重发。
- 状态、版本、依赖和图规模拒绝展示 server 错误、相关 task ID 或规模信息及 requestId。
- 本地准备失败没有远端 mutation；远端写失败不重试，取消在各顺序步骤之间继续生效。

<a id="pt-t5"></a>
## PT-T5：安装与服务联调验收

状态：未开始。前置：PT-T3、PT-T4。

### 文件归属与范围

负责 CLI 安装验收、真实 Git 和隔离 Go/PostgreSQL 联调 fixture、验收证据与状态同步。
若需要调整共享验证入口或 CI，由本任务独占相关文件，并保留 Go、web 与所有原生 CLI
必选检查。服务接口和 schema 仍不属于本任务的功能范围。

### 完成条件

- `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm acceptance` 通过，并保留原有
  review/update 安装场景。单元和安装测试使用受控 server 响应及真实 Git。
- 实际安装的 CLI 与隔离真实 Go/PostgreSQL 服务完成 project/task 创建、依赖推进、
  查询、更新、重启持久化及版本冲突；证明地址等价和本地发现记录生效。
- Linux、macOS、Windows 的工作负载证明路径、Git、文件替换和退出行为；受控 HTTP
  失败覆盖取消、整体超时、持续前进 cursor、响应字节超限、错误响应、续页失败和写结果不确定，
  不能用绿灯代替行为证据。
- 明确记录实际命令、源码/产物身份、结果和局限；收尾回收所属服务、Git fixture、
  数据库与临时配置。同步实现状态和受影响文档，不将未运行的检查记成通过。
