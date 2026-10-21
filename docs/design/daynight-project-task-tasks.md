# Project 与 Task CLI 实现任务

状态：PT-T1–PT-T5 的功能与验收均已完成；集成状态由
[PR #55](https://github.com/codetreker/daynight/pull/55)记录。

本文拥有任务编号、状态、依赖、文件归属和完成条件。
[需求](../spec/daynight-project-task.md)拥有 PT1–PT10 的可观察行为，
[设计](daynight-project-task.md)拥有配置、地址身份、发现与缓存和 HTTP 机制，
[决策记录](../../.agents/notes/implemented/architecture/2026-10-20-project-task-cli-design.md)
保存范围和取舍。文档记录已确认的交付目标；状态按实际实现及验证证据更新。

PT-T1–PT-T5 记录原有完整 CLI 的交付与历史证据。有界 `task ready` 选择由
[选择决策](../../.agents/notes/implemented/feature/2026-10-21-bounded-ready-task-selection.md)
拥有，实时任务为 `ada23216-a6e6-45de-89f4-67f1f71fbbfc`；其当前行为归入需求
PT7、PT8 和 V13。该扩展保持 `task list --ready` 的完整分页，未改变下述历史验证
结果的范围。

## 任务顺序

| 编号 | 任务 | 状态 | 前置 | 主要交付 | 对应要求 |
|---|---|---|---|---|---|
| [PT-T1](#pt-t1) 服务访问基础 | 已完成 | 无 | 共享 YAML、独立 server 配置、HTTP 客户端和错误/取消 | PT2、PT8、PT9 |
| [PT-T2](#pt-t2) 仓库关联发现 | 已完成 | PT-T1 | Git 定位、地址身份、完整发现、本地记录及忽略规则 | PT3、PT4、PT5 |
| [PT-T3](#pt-t3) Project 命令 | 已完成 | PT-T1 | create/list/show、命令登记和帮助、输出 | PT1、PT6、PT8 |
| [PT-T4](#pt-t4) Task 命令 | 已完成 | PT-T2、PT-T3 | create/list/show/update/graph、版本及依赖更新 | PT1、PT4、PT7、PT8、PT9 |
| [PT-T5](#pt-t5) 安装与服务联调验收 | 已完成 | PT-T3、PT-T4 | 实际 CLI、真实 Git、Go/PostgreSQL 联调和原生证据 | PT1–PT10 |

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

状态：已完成。前置：PT-T1。

本地 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm acceptance` 均通过；
普通测试 1418 项通过，10 项平台专属测试在 Linux 上跳过，安装验收 2 组通过。
Bash 4.2、Bash 5.2、zsh 5.9 各 68 个真实 Tab 场景、每个 shell 的两种编辑器
就绪证明，以及未初始化 compinit 的拒绝检查共 211 项通过；补全期间没有调用
CLI/Node。就绪证明分别覆盖进入编辑器前的提示符阻塞和 capture widget 完成前
排队的 reset，机制由[补全设计](daynight-completion.md#验证)拥有。

实际编译入口的受控 HTTP 证明创建只提交一次、UUID 和时间精度保留、完整分页
JSON 与续页失败 stdout 为空；真实 Go 服务联调仍由 PT-T5 验证。长名称放大填充
问题经线性完整输出修复，独立复审无 Critical/Major。
[PR #50](https://github.com/codetreker/daynight/pull/50) 已作为 `2463776` 合并；最终
head `d6172a2754030cd04e82dfbc07ad1204af14cdbe` 通过远端 review，全部 7 项必选检查在
[CI run 39419829100](https://github.com/codetreker/daynight/actions/runs/39419829100)
通过；合并后的[主线 CI run 39420853858](https://github.com/codetreker/daynight/actions/runs/39420853858)
全部 7 项检查通过。该交付保留 PT-T5 的真实 Go 服务联调要求。

### 文件归属与范围

负责 `packages/daynight/src/commands/project/`、对应测试，并在交付期间独占
`src/cli/commands.ts` 的 project 登记及根帮助衔接；同时拥有所需的共享 text
语法、静态补全及实际 shell 验收衔接。共享 server 执行层、配置取消信号和
服务文本规则保证 project 操作独立加载并保留合法值。使用现有 API 创建、列举和读取 project，
`create` 接受必填名称和可选 repo，省略 repo 时读取当前 worktree 有效 origin；创建
前通过完整分页进行仓库身份预检，唯一匹配返回既有资源。该行为由
[创建预检决策](../../.agents/notes/implemented/bug-fix/2026-10-21-project-create-repository-discovery.md)
拥有。列表覆盖完整分页，详情使用明确 ID。

### 完成条件

- 裸组及各级帮助不触发业务依赖；参数错误与操作错误使用既有退出规则。
- 实际编译 CLI 完成 create/list/show，并在明确 ID/地址情况下支持仓库之外调用。
- 机器输出保持完整 JSON；续页失败不输出部分成功数组，文本错误与诊断进入 stderr。
- 根命令登记、review/update 的帮助与操作保持独立；创建预检使用共享仓库身份规则，server 继续负责写入地址的服务端校验。

<a id="pt-t4"></a>
## PT-T4：Task 命令

状态：已完成。前置：PT-T2、PT-T3。

本地 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm acceptance` 均通过；
普通测试 1510 项通过，10 项平台专属测试在 Linux 上跳过，2 组既有安装验收通过。
Task 专项 63 项、共享语法与补全专项 87 项，以及实际编译入口的 6 项受控 HTTP
场景通过。Bash 4.2、Bash 5.2、zsh 5.9 各 110 个真实 Tab 场景保留 68 个既有
场景并增加 42 个 Task 场景；每个 shell 的两种就绪证明及 compinit 拒绝检查合计
337 项通过，补全期间没有调用 CLI/Node。

命令与渲染、共享语法与补全的独立最终审查均未发现 Critical/Major。
[PR #54](https://github.com/codetreker/daynight/pull/54) 已作为 `c19b064` 合并；
最终 head `b0b79927d5785e60746deef0d0485c9a626bc3ea` 通过远端 review，全部 7 项必选检查在
[CI run 39422326109](https://github.com/codetreker/daynight/actions/runs/39422326109)
通过；合并后的[主线 CI run 39423564636](https://github.com/codetreker/daynight/actions/runs/39423564636)
在 `c19b064` 上全部 7 项检查通过。上述受控 HTTP 与既有安装验收不代表 Task
安装产物的真实 Go/PostgreSQL 全流程联调，后者仍由 PT-T5 验证。

### 文件归属与范围

负责 `packages/daynight/src/commands/task/` 和对应测试；PT-T3 完成后接管
`src/cli/commands.ts` 的 task 登记。将仓库关联模块与已有 create/list/show/update/graph
HTTP 用例组合；同时拥有描述空值、重复依赖、状态候选及 text 选项内联赋值所需的
共享语法、帮助、Bash/zsh 生成器和真实 shell 验证。project/task 业务规则继续由
Go 服务持有。

### 完成条件

- 所有 task 操作接受可选 `--project`，默认发现并使用当前仓库对应的 project。
- 共享语法保留描述空值、依赖输入顺序及重复 ID，支持 text 内联赋值和固定状态候选；
  目录内联、开关内联、重复标量选项和分离的前导连字符值保持拒绝。
- 创建、详情、状态/ready 筛选、完整图和 JSON 输出与需求一致。
- 更新支持字段保留、清空描述、完整替换依赖和显式清空；读版本后 PATCH，或使用
  `--if-version` 指定预期版本，不能在冲突后自动获取新版本重发。
- 状态、版本、依赖和图规模拒绝展示 server 错误、相关 task ID 或规模信息及 requestId。
- 本地准备失败没有远端 mutation；远端写失败不重试，取消在各顺序步骤之间继续生效。

<a id="pt-t5"></a>
## PT-T5：安装与服务联调验收

状态：已完成。前置：PT-T3、PT-T4。功能与托管验收已完成；集成状态见
[PR #55](https://github.com/codetreker/daynight/pull/55)。

以下为 PT-T5 交付时的历史验证记录；当时期限探针真实等待生产期限，当前测试侧
短期限 mock 由[CI 验证效率决策](../../.agents/notes/implemented/testing/2026-10-21-ci-validation-efficiency.md)
定义。记录中的耗时及源码身份保留其原始范围。

本地验证使用 `c19b064b094aae6634ca6d62e943a73d22008262` 上的 dirty 工作树，
包版本 `0.6.0`，Node `v24.19.0`。`pnpm typecheck`、`pnpm build`、1510 项普通
测试均通过，Linux 上 10 项平台专属测试跳过；既有 review/update 及新增 project/task
三套安装验收通过。最终 Linux project/task 验收覆盖 10 类场景、69 个 HTTP 请求，
安装、子进程和 HTTP 服务全部回收。helper 的预先取消及运行中 pnpm/后代取消
注入保留原始原因并完成回收，Git fixture 命令显式关闭外部 fsmonitor。

完整 Go gate 的 build、vet、race、固定 go-cov 及 strict raw profile 检查通过：
309 项 Go 测试（109 个顶层），原始覆盖 `1153/1155`。Go `1.27.2`、PostgreSQL
`18.6` 下，`installed_cli_project_task_workflow` 用时 8818 ms，实际重启并回收
2/2 个 server、38/38 个 CLI，workspace 与 1 个 schema 已删除，无所属会话残留。
并发 PATCH 的实际结果为一个 `200` 和一个 `409`，保留各自 request ID。

六个公开安装 CLI 默认预算场景全部通过：精确 128 MiB 单响应、256 MiB 累计
边界成功，各增加 1 字节拒绝且 stdout 为空；请求期限在 30104 ms、1 次请求后
拒绝；持续推进 cursor 的总期限在 300103 ms、1187 次请求后拒绝。六个场景均确认
child reaped、socket/server 关闭及 fixture 删除；最终服务 receipt `passed=true`、
`installedFixtureRemoved=true`、`failures=[]`。独立数据库检查确认所属 schema 与
session 均为零，预算目录、共享安装目录、所属 PostgreSQL container 及匿名 volume
均已回收。

三个独立源码最终审查未发现 Critical/Major，预算 receipt 与脚本 hash 的独立复核
通过。本地 dirty 证据保留为开发时的观测，托管结果另以干净源码身份记录；
review 与合并状态由 PR #55 拥有。

[托管 run 39428165296](https://github.com/codetreker/daynight/actions/runs/39428165296)
对 PR head `e9a634aca23710ffe46723fcdb2cf8e7a75d56bf` 的全部 7 项检查通过；
实际构建的干净 merge revision 为 `2e7b8da99cf4b5de6da9c8083446f84fd19f1daf`，
三个原生平台均为 Node `v24.22.0`、包 `0.6.0`，安装 entry SHA-256 一致。Linux
和 macOS 各通过 10 类、69 请求，Windows 通过 8 类、67 请求；Windows 不计入
POSIX EACCES 与真实 POSIX SIGINT 两类，八类公共场景仍覆盖 Git、worktree、
submodule、缓存、锁、原子文件及拒绝路径。三个 receipt 的回收标记均成功且零错误。

托管 Go 使用 `1.27.2`、PostgreSQL `18.6`，raw profile 复核为 `1153/1155`。
实际 CLI workflow 用时 10348 ms，回收 2/2 个 server、38/38 个 CLI、workspace
和 1 个 schema，无所属会话；并发 PATCH 为 `200`/`409`。六个生产预算场景全部
通过：单响应边界及 +1 字节分别 1207/849 ms，累计边界及 +1 字节分别
1734/1712 ms；请求期限 30148 ms、1 次请求，总期限 300136 ms、1194 次请求。
成功 stdout 分别为 202/602 字节，拒绝场景均为空，所有 probe 与共享安装回收成功。
验证分层与取舍由
[安装联调决策](../../.agents/notes/implemented/testing/2026-10-20-installed-project-task-acceptance.md)拥有，
场景、产物身份及预算 receipt 的解释见[仓库验证说明](../../README.md#validation)；
逐次运行结果随对应 PR 与 CI 保存。

### 文件归属与范围

负责可复用 CLI pack/install fixture、三原生平台的受控 HTTP/Git 安装验收、真实
Go/PostgreSQL command-package 联调、期限与字节预算探针、证据与状态同步。同次服务
验证只安装一次，Go 场景与预算探针复用该产物。Node 编排层保留既有 go-cov 参数
及严格覆盖率检查，之后在 Go 默认 10 分钟计时器之外运行公开安装命令的期限与
真实响应字节预算探针。期限通过测试侧 mock 缩短，生产默认值单独断言。统一检查
脚本与 CI 由本任务独占，保留原有 20 分钟 Go 作业、Go、
web、补全及三原生 CLI 必选检查。服务接口、生产预算和 schema 不属于功能改动范围。

### 完成条件

- `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm acceptance` 通过，并保留原有
  review/update 安装场景。单元和安装测试使用受控 server 响应及真实 Git。
- 新增三原生平台的安装 CLI 受控 HTTP/Git 场景，保留既有 review/update 两套安装验收；
  source、pack、安装身份及进程、HTTP、Git 与目录清理写入仓库根 `.tmp/project-task-evidence.json`。
- 实际安装的 CLI 与隔离真实 Go/PostgreSQL 服务完成 project/task 创建、依赖推进、
  查询、更新、重启持久化及版本冲突；证明地址等价和本地发现记录生效。
- Linux、macOS、Windows 的工作负载证明路径、Git、文件替换和退出行为；受控 HTTP
  失败覆盖取消、整体超时、持续前进 cursor、响应字节超限、错误响应、续页失败和写结果不确定，
  不能用绿灯代替行为证据。
- 安装 CLI 通过公开命令验证响应开始后停顿的单次期限和持续推进 cursor 的总期限；
  测试侧 mock 使用 1 秒单次、3 秒总期限，生产默认 30 秒/5 分钟单独断言且保持不变。
  gzip 流式有效 JSON 以空白补齐真实 128 MiB 单响应和 256 MiB 累计边界，边界值
  必须成功、各增加 1 字节必须拒绝。回执标明实际期限与 mock 状态。
  服务及预算验证写入仓库根 `.tmp/project-task-service-evidence.json`，Go 原有 receipt
  中的 CLI 要求编号使用 `PT.V*` 命名空间，既有服务场景和覆盖率证据保持独立。
- 明确记录实际命令、源码/产物身份、结果和局限；收尾回收所属服务、Git fixture、
  数据库与临时配置。同步实现状态和受影响文档，不将未运行的检查记成通过。
