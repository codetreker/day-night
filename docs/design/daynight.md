# Daynight 客户端架构设计

状态：`packages/daynight/` 是通过 `@codetreker/daynight` 分发的 TypeScript 客户端
命令工具包，支持 Linux、macOS 和 Windows。`review` 提供 GitHub PR 审查，`update`
管理当前 npm 全局安装，`setup` 提供按能力配置的引导，`completion` 生成 Bash 和 zsh
的原生补全脚本并安装启动配置；`skill` 提供公开 `using-daynight` skill 的交互安装。project/task
CLI 的共享配置、HTTP、仓库关联基础及 project/task 命令已完成，安装产物、真实服务
与默认预算验收已通过托管验证；集成状态见[PR #55](https://github.com/codetreker/daynight/pull/55)。
[专属设计](daynight-project-task.md)拥有机制，[实现任务](daynight-project-task-tasks.md)
拥有交付状态。行为归属见[客户端需求](../spec/daynight.md)及
[review 需求](../spec/daynight-review.md)，结构选择见
[命令组合决策](../../.agents/notes/implemented/architecture/2026-10-20-client-command-composition.md)。
[补全设计](daynight-completion.md)拥有共享语法描述、脚本生成和 shell 加载机制，
[Agent skill 设计](daynight-agent-skill.md)拥有公开资源、交互安装、scope 与覆盖机制。

## 命令与职责

```text
daynight                            # 顶层帮助
daynight --help                      # 同 -h
daynight --version                   # 同 -v
daynight update
daynight setup                       # 选择服务连接、review 或两者
daynight setup --server-url <url>
daynight setup --review-repo <remote> [--review-path <path>]
daynight review                     # review 帮助
daynight review run
daynight review list                 # 同 review ls
daynight review add-repo <remote> [--path <path>]
daynight completion                 # 补全帮助
daynight completion bash
daynight completion zsh
daynight completion setup [--shell bash|zsh] [--rc-file <path>]
daynight skill                       # skill 帮助
daynight skill install               # 多选 Agent，再选择 User 或 Project scope
daynight project
daynight project create <name> [--repo <repo>]
daynight project list [--json]
daynight project show <project-id> [--json]
daynight task
daynight task create --title <title> [options]
daynight task list [--status <status>] [--ready] [--json] [--project <project-id>]
daynight task ready [--limit <N>] [--json] [--project <project-id>]
daynight task show <task-id> [--json] [--project <project-id>]
daynight task update <task-id> [options]
daynight task graph [--json] [--project <project-id>]
daynight task attachment
daynight task attachment put <task-id> <file> [--path <relative-path>] [--project <project-id>]
daynight task attachment list <task-id> [--tree | --json] [--project <project-id>]
daynight task attachment read <task-id> <relative-path> [--project <project-id>]
daynight task attachment remove <task-id> <relative-path> [--project <project-id>]
```

各组和操作在该层唯一参数为 `--help` 或 `-h` 时显示帮助。顶层无参数显示帮助，
未知命令与无效参数退出 2，业务执行失败退出 1 并保留原因。旧的 `--daemon-review` 和顶层 `add-repo` 不再是
有效命令。review 操作沿用[review 设计](daynight-review.md)的配置、持久化和运行保证。

以上命令和后文源码树描述当前实现。project/task 的业务机制与完整联调要求由
[专属设计](daynight-project-task.md)拥有。

客户端外壳处理顶层帮助、版本、命令选择及通用退出结果。每个命令模块负责自己的
定义、参数、帮助、依赖和执行生命周期。`review` 再按配置登记、本地列表、前台运行分派，
避免查询或配置操作初始化审查运行时。`update` 属于包安装生命周期，不属于 review。
`skill` 拥有已安装 Agent 检测、终端选择、scope 规划和 bundle 覆盖，独立于服务及
review 配置。独立 Go 服务与浏览器应用保持各自的数据和生命周期。已确认的 project/task 设计
通过独立客户端模块使用现有 HTTP API，业务数据仍由 Go 服务持有；HTTP 客户端、仓库上下文和 project 入口已实现，
task 入口已实现。

## 源码组织

```text
src/
  main.ts
  cli/
    application.ts
    commands.ts
    context.ts
    byte-output.ts
    byte-output-helper.ts
    prompts.ts
    cancellation.ts
    schema.ts
  config/
    paths.ts
    document.ts
    files.ts
    errors.ts
    setup.ts
    server.ts
  api/
    index.ts
    types.ts
    operation.ts
    json.ts
    parse.ts
    client.ts
  repository/
    index.ts
    identity.ts
    git.ts
    binding.ts
    context.ts
  commands/
    skill/
      definition.ts
      command.ts
      agents.ts
      targets.ts
      install.ts
      skills/using-daynight/
        SKILL.md
        references/handbook.md
        references/autopilot.md
        references/run-task.md
        references/create-task.md
    setup/
      definition.ts
      command.ts
    task/
      definition.ts
      command.ts
      rendering.ts
      attachment.ts
      attachment-rendering.ts
    project/
      definition.ts
      command.ts
      rendering.ts
    server/
      runtime.ts
    review/
      definition.ts
      command.ts
      config.ts
      paths.ts
      repositories.ts
      listing.ts
      model.ts
      polling.ts
      coordinator.ts
      runtime.ts
      skill.ts
      skills/
        daynight-review/
          SKILL.md
      store.ts
      instance-lock.ts
      processes.ts
      adapters/
        github.ts
        worktrees.ts
        copilot.ts
    update/
      definition.ts
      command.ts
      updater.ts
    completion/
      definition.ts
      command.ts
      setup.ts
      bash.ts
      zsh.ts
  platform/
    skill-bundle.ts
    diagnostics.ts
    filesystem.ts
    files.ts
    terminal.ts
    text.ts
```

`main.ts` 是稳定的可执行入口，向应用传递包版本和从该入口确定的包目录；编译后仍为
`dist/main.js`。`cli/context.ts` 只描述客户端上下文：版本、包目录、输入输出，以及
用户主目录和工作目录的惰性查询函数；不放入已解析的 review 路径、配置或运行函数。
`cli/commands.ts` 组合各命令的轻量定义并保存异步执行入口；`cli/application.ts`
只在选中命令时调用加载函数。`cli/schema.ts` 定义命令、别名、选项和值类型、位置
参数及固定候选；选项元数据表达 required、allowEmpty、choices 和 repeatable，
并由它完成参数校验与帮助渲染。各 `definition.ts` 不导入业务实现、
配置、文件系统探测、原生数据库或适配器；根分发可以读取这些定义而不加载业务。
Bash 和 zsh 生成器消费同一命令树，避免解析、帮助和补全分别维护语法。增加业务
命令需要登记入口和实现自己的模块，顶层分发不认识该命令的业务依赖。

命令组先完成参数和帮助分派，再按操作加载默认实现。裸命令、帮助、版本及无效参数
无需解析用户主目录、打开数据库或调用外部程序。补全生成同样不查询工作目录、
review 状态或网络。`setup` 与 `review add-repo` 加载配置保存能力；有效服务及 review
业务调用先按当前能力检查必要配置。需要时完成引导，随后列表加载配置解析与只读
快照，`review run` 才加载运行时、信号处理、实例锁和适配器。
该顺序也使自更新进程不加载待替换的 SQLite 原生 addon。

`config/` 拥有共享配置路径、严格 YAML、已知顶层字段和保留注释的文件保存协议；
`server.ts` 提供独立 server 字段投影。`api/` 拥有服务 DTO、精确数值 JSON、
命令级期限和字节预算、HTTP 错误、完整分页及有界 ready 查询，供业务命令组合。共享层不导入
review 或 update；服务器客户端也不依赖 YAML、SQLite 或 Git。`repository/` 将有效 origin、通用
仓库身份、远端 project 校验与本地关联组合；原子文件替换由 `platform/files.ts`
复用，配置保存和仓库元数据各自拥有锁、路径校验及调用顺序。

review 的配置和路径类型明确以 `ReviewConfiguration`、`ReviewPaths` 命名。
`commands/review/model.ts` 持有领域和安全恢复证明类型，store 专注持久化；
`polling.ts` 组合远端只读观测与本地原子状态提交，GitHub 适配器专注远端查询。
[review 模块职责表](daynight-review.md#单进程与普通模块)解释具体职责及执行不变量。
共享的 `platform/` 承载诊断、文件系统和无业务副作用的 bundle 捕获/entrypoint 校验；
这些函数不导入命令模块。review 继续拥有快照、哈希和执行协议。

源码测试按 `test/cli/`、`test/config/`、`test/api/`、`test/commands/review/`、
`test/commands/update/`、`test/commands/completion/`、`test/commands/project/`、
`test/commands/server/`、`test/commands/task/`、`test/repository/` 和 `test/platform/`
镜像职责，构建与版本策略测试位于 `test/tooling/`，共享 fixture 与帮助函数保持明确
归属。使用普通函数和具体类型；外部命令、时钟与故障点只在有实际
验证需求的边界注入，不增加通用插件框架或依赖注入容器。

## Shell 补全

`commands/completion/` 通过共享命令树生成 Bash ≥4.2 和 zsh 的原生脚本；有效生成请求
只向 stdout 写入脚本。裸 `completion` 及其帮助只显示使用说明，错误 shell 或无效
参数沿用状态码 2。脚本生成不读取配置和状态，不加载 review 或更新业务。
`completion setup` 在参数校验后才加载 `setup.ts`，检查调用 shell 并安装持久启动
配置。它独立拥有 shell 检测、默认或显式文件选择、完整管理块识别及保留原文件
身份的写入，不改变生成操作的无 I/O 保证。它与根 `setup` 的服务/review 配置引导
分别归属各自命令；[客户端 C7](../spec/daynight.md#c7-补全启动配置安装)拥有其行为。
普通子进程不能修改父 shell 的函数注册，`completion setup` 输出既有 source 命令
供当前会话启用。

脚本在 source 时注册 `daynight` 补全，Bash 检查版本下限，zsh 要求调用者已完成
`compinit`，缺少初始化时明确报错并加载失败。按 Tab 时只使用 shell 内存中的语法
和本地目录枚举，不启动 Node、
daynight 或网络请求。参数语法保留原有唯一帮助参数、remote 前后一次 `--path`、
不接受 `--path=value` 或 `--` 的规则。目录候选保留实际参数边界，且不限制尚未
创建的路径输入。生成和加载机制、引号与光标处理由[补全设计](daynight-completion.md)
统一说明，启用命令由[README](../../README.md#shell-completion)拥有。

[补全决策](../../.agents/notes/implemented/feature/2026-10-20-shell-completion.md)
记录 Bash 下限、zsh 原生集成和本地执行的成本；
[setup 决策](../../.agents/notes/implemented/feature/2026-10-21-completion-setup.md)记录
启动文件安装及当前会话边界。脚本输出用于 source；zsh `fpath`
自动加载需要不同的装载形式，未包含在该输出的使用承诺中。

## Server 命令执行

`project/definition.ts` 声明 create/list/show、创建的必填位置名称、可选 `--repo` 与查询 JSON 标志。
`command.ts` 在帮助和语法校验后才加载共享 server runtime；show 的 UUID 校验
先于配置读取。list/show 及显式 `--repo` 的 create 不查询工作目录或 Git；省略 repo
时 create 复用 Git 发现以取得当前 worktree 的有效 `origin`，不加载关联保存流程。
两种创建路径都先完整列举 project，以共享仓库身份规则比较：零匹配才 POST 原始名称
和地址，唯一匹配返回既有 project，多匹配报告 ID。查询失败、取消和期限错误阻止
后续创建。该预检保持服务允许重复 repo 的边界，不提供并发创建的原子唯一性；
project 操作不读写仓库绑定或 ignore 规则。`rendering.ts` 使用完整项目标签块，
输出大小随字段内容线性增长；JSON 保留 API 字段和值。

`commands/server/runtime.ts` 在首次配置读取前建立操作和信号取消源，配置完整时，
读取、HTTP 和渲染共享期限与字节预算。仅识别出结构化的必要配置缺失时，释放初始
操作的期限，在同一取消信号下完成引导；保存后的重新读取建立新操作及完整业务
预算。回调返回 `string | void`：元数据操作返回完整字符串，在最终检查取消和期限后
一次写 stdout；附件 read 通过 `CliContext.stdoutBytes` 逐段输出并返回 void。
结束时先等待 `closeStdoutBytes` 关闭并回收已创建的输出辅助进程，再移除本次的信号
监听器并释放操作，清理失败保留原因。SIGINT/SIGTERM 以及 Windows SIGBREAK 均
进入这一取消源；配置读取接受同一 AbortSignal。Task 复用此执行层；它不控制 Go
server 的启动或关闭。

Task 的 definition、command 和 rendering 分别拥有共享语法、操作组合和完整
资源输出。`ready` 的 `--limit` 在任何配置、Git 或 HTTP 访问前校验为十进制整数
`1..100`，默认 `10`。它调用 `api/client.ts` 的 `listReadyTasks`，仅发送一次带
`ready=true` 和所选 `limit` 的 task GET；合法 `nextCursor` 不触发续页。该 API
操作在返回前验证数量不超限、每项确为 ready 且 task ID 不重复。`list` 仍使用完整
分页。完整的请求、排序和输出机制见
[project/task 设计](daynight-project-task.md#api-映射与更新机制)。

Task 的 `attachment.ts` 单独组合单文件上传、完整分页列表、原始读取和删除。
API 客户端分别消费 JSON、字节流与 204 空响应，字节流不经过 UTF-8/JSON 解析或
元数据字节上限。二进制输出延迟创建本次命令拥有的子进程，以有界 frame 和写入
确认传递背压，使父进程在 stdout 阻塞时仍可响应取消和期限。详细的流、关闭及错误
契约由[附件设计](daynight-task-attachments.md#cli)拥有。

描述通过 `value.allowEmpty` 保留空值；状态通过 `value.choices` 统一参数校验和补全
候选，帮助使用选项说明；重复依赖通过 `repeatable` 从首次出现起形成保留输入顺序及重复值的
数组。text 内联赋值按首个 `=` 分隔并支持前导连字符，目录与开关继续拒绝内联。
参数验证先于配置、Git 及 HTTP；显式 project 直接读取远端详情，自动分支才加载
`repository/`，并在 task 写入前完成关联验证与保存。

`platform/text.ts` 按 Unicode White_Space、有效 Unicode 和无 NUL 校验服务文本，
CLI 参数与 API DTO 共用该规则并保留原值；`platform/terminal.ts` 仅负责可读输出中的
终端控制字符转义。完整 JSON 不经过可读格式化。

## 按需配置引导

参数和业务值校验先于配置引导，帮助、版本、补全和自更新保持各自独立入口。
`setup` 的轻量定义与其他命令一样由共享语法生成帮助和 shell 补全；执行实现仅在
选中该命令时加载。服务业务入口和 review 的 run/list 入口按各自的能力调用同一
配置引导机制，不通过捕获任意业务错误重新分派命令。`config/errors.ts` 区分结构化的
缺少配置结果；`cli/prompts.ts` 拥有终端文本输入和类型化选择，`cli/cancellation.ts`
共享 setup 与 skill 的信号、取消及关闭生命周期，`config/setup.ts` 组合配置收集及持久化，`commands/setup/` 拥有主动入口。review 的仓库更新函数由登记和 setup 共用。

预检读取严格 YAML，区分不存在的文件或必需字段与共享文档错误、当前能力无效字段
及读取错误。
只有前者允许自动引导。服务能力只检查 `serverUrl`；review 能力只检查仓库登记，
不要求服务地址。当前能力已提供但无效的值保留原错误，其他能力的业务值不参与
校验；review 的 `repositories: []` 也不会触发引导。
这使只使用服务命令的机器无需配置 review，并避免把数据损坏当成首次运行。

交互要求 stdin 与 stderr 同为 TTY；stdout 可重定向，以保留 `--json` 的完整结果。
提示、保存消息和取消诊断写 stderr。无参数 setup 先选择服务连接、review 或两者；
显式 `--server-url`、`--review-repo`、`--review-path` 直接组成配置请求且不询问，
路径选项必须伴随仓库地址。服务 URL 没有隐含默认值；review 可省略路径并复用现有
登记默认值。非交互缺配置立即失败，诊断给出对应的显式 setup 命令。

引导先收集全部所选值，再进入共享配置写入协议。写入者持独立配置锁重新读取当前
YAML，在最新文档上设置服务地址或复用 review 仓库登记逻辑，然后验证并进行同目录
原子替换。锁内比较所选字段与收集前的值；若已改变，报冲突并要求重新设置。
其他字段的并发完成修改合并保留。现有注释、其他能力的
字段、已有仓库路径和权限模式均保留；两种能力同时设置也只进行一次保存。锁冲突、
校验、写入及清理失败沿用原有显式错误和资源所有权规则。

交互阶段拥有取消与输入结束处理；取消或 EOF 时不提交收集到的部分值，不进入业务。
配置收集和保存不进行网络、认证、clone、SQLite 或审查启动。自动引导成功后调用
原操作一次，保留原参数；后续操作失败不撤销已保存的配置。服务命令仅在需要
实际引导时释放首次读取的期限，并在保存后重新建立五分钟业务预算；配置完整时
沿用首次读取起的同一预算，人工输入不消耗业务期限。共享协议的必需结果由
[客户端 C6](../spec/daynight.md#c6-按需配置引导)拥有，决策及替代方案见
[配置引导决策](../../.agents/notes/implemented/feature/2026-10-21-guided-configuration-setup.md)。

## 配置与持久化

review 的配置仍为 `~/.daynight/config.yml`，SQLite 仍为 `~/.daynight/state.sqlite`；
会话、锁、日志、缓存和临时文件仍在同一状态目录，PR worktree 仍位于各仓库的
`.worktrees/`。既有 YAML 字段、状态路径和持久化身份继续使用，不新增命令分区。
review 运行时通过显式 SQLite 迁移从版本 1 升到版本 2，保存远端发布证据和一次性
conversation 后续轮次，保留旧边界、预算、会话、进程证据及 worktree；只读列表接受
两个版本并不执行迁移。业务模块归属与磁盘目录归属分别管理，源码整理本身不改变
持久化身份。详细格式、验证、锁及恢复规则由
[review 设计](daynight-review.md#本地数据与-sqlite)统一定义。

[project/task 配置设计](daynight-project-task.md)定义同一 YAML 中的 `serverUrl`。
共享解析器识别全部已知顶层字段并保留 YAML 文档，业务投影分别校验值。只有
server 地址的配置可独立加载；review 不校验该地址，添加首个 review 仓库时保留它。

Git worktree 根目录 `.daynight/project.yml` 保存 server、仓库身份和 project ID 的
本地关联。它与主目录下的 review 状态用途不同；关联模块在命中时验证远端 project，
失效时完整发现并在有效忽略规则下原子保存。Task 命令在任务读写之前调用该模块；
目录、锁、忽略规则和缓存寿命由[专属设计](daynight-project-task.md)定义。

## npm 全局自更新

`commands/update/command.ts` 在参数校验后按需加载 `updateSelf`，先于用户主目录解析、
配置加载和 review 运行时加载。review 各操作的依赖只在对应操作中动态导入，因此更新
进程不会加载 SQLite 原生模块，避免它自身占用待替换的 addon。帮助和参数错误同样
无需进入运行时；更新不接触配置、SQLite、实例锁或 Copilot 会话。`updateSelf` 返回
`current`、`ahead` 或 `updated`，携带原版本和查询目标版本；CLI 据此打印单行结果，更新成功时提示重启运行中的 reviewer。

更新模块使用稳定入口 `main.ts` 传入的包目录，通过 `realpath` 和包清单确认
`@codetreker/daynight` 及 `dist/main.js` bin，再按平台推导实际全局 prefix。POSIX 的包路径必须为
`<prefix>/lib/node_modules/@codetreker/daynight`，启动器为 `<prefix>/bin/daynight`；
Windows 的包路径必须为 `<prefix>/node_modules/@codetreker/daynight`，启动器为
`<prefix>/daynight.cmd`。POSIX 启动器解析到当前包的绝对入口；Windows 使用
`read-cmd-shim` 解析 npm 生成的命令包装脚本，再确认相同的实际入口。包结构或启动器
不符就拒绝，保留源码、本地依赖、`npx`、pnpm 和链接安装原有的包管理权。
[npm 的目录规则](https://github.com/npm/cli/blob/b888cc9a9ff34a8b023ff47b784692396635397b/docs/lib/content/configuring-npm/folders.md)
定义全局包与启动器的位置；
[read-cmd-shim](https://github.com/npm/read-cmd-shim/blob/9887cf0f2416f05b41cd3318b8fce08d21a20d4e/lib/index.js)
负责解析 npm 包装脚本。

模块定位 npm 的 JavaScript 入口并用当前 `process.execPath` 启动，避免 PATH 中的其他
Node.js 决定目标 engine。查询和安装都使用 `--global --prefix <实际 prefix>`，子进程
工作目录固定在 prefix，处于待替换包外部。保留 npm 的环境、用户配置与全局配置，让
registry 和认证沿用该全局安装上下文；不读取调用目录的项目 `.npmrc`。
[npm 配置规则](https://github.com/npm/cli/blob/b888cc9a9ff34a8b023ff47b784692396635397b/docs/lib/content/configuring-npm/npmrc.md#L61-L77)
明确全局模式排除项目配置。

`npm view @codetreker/daynight@latest version --json` 的标量或单元素数组输出必须
解析出唯一的规范 SemVer。用 `semver` 比较优先级，当前或领先版本直接成功返回；更新时将已解析的确切版本传给
`npm install`，不会再次让可变的 `latest` 选择目标。需要安装前检查调用目录的实际路径，
位于当前包内时要求从外部目录重试，避免替换使调用进程的工作目录失效。安装显式使用
`--engine-strict --force=false`，沿用 npm 的权限和错误，不调用 sudo，也不改变 Node.js
运行时要求。

安装输出直接转发，查询输出受限且用于解析；查询、安装和新进程版本验证均有时间上限。
npm 成功退出后，重新读取安装包的身份、bin 和确切版本，重新验证启动器，最后使用同一
Node.js 和新安装 CLI 的绝对路径执行 `--version`。该新进程报告的版本必须与目标严格
相同，才能返回 `updated`。任一阶段失败都保留错误原因并以非零状态退出。

npm 管理替换、安装恢复和并发安装行为，模块不引入另一套包替换或回滚机制。更新失败
不承诺原安装文件完整保留；需要按 npm 的错误处理安装。命令不控制已运行的 reviewer，
其内存和已加载模块保持原版本，操作者须重启后使用新版本。Windows 上被占用的原生
addon 可能阻止替换，npm 失败直接可见。
[自更新决策](../../.agents/notes/implemented/feature/2026-10-20-cli-self-update.md)
记录包管理权、范围选择和拒绝其他安装方式的依据。

## 构建、安装与交付

开发使用 Node.js 24 LTS、pnpm 10.34.5、TypeScript ESM 和固定依赖版本。构建先执行
`node scripts/clean-dist.ts` 删除包的 `dist/`，再通过 `tsc -p tsconfig.build.json`
生成产物，防止模块移动后保留旧的可执行文件。构建还将 review 的完整内置 skill
bundle 复制到 `dist/commands/review/skills/daynight-review/`，由既有 `dist` 发布规则
纳入安装包。清理和资源复制脚本从自身位置定位目录，调用者工作目录不会改变目标。
包的 bin 及发布入口保持 `dist/main.js`。资源定位沿用稳定入口传入的包目录；
[review skill 设计](daynight-review-skill.md)定义捕获、快照和加载流程。

独立的普通测试及安装验收命令各自先构建包，既验证源码职责，也通过编译产物验证
公开命令。原生 CI 先 typecheck 并构建一次，再直接运行普通和安装验收的 Vitest
配置，两个阶段使用同一份编译产物。`pnpm typecheck`、
`pnpm test`、`pnpm build`、独立 `pnpm acceptance` 和 `pnpm completion:acceptance`
的实际入口由
[README](../../README.md#cli-development)维护。资源复制回归验证从无关工作目录执行实际
脚本，在隔离包的全新目标下检查完整 bundle；重复排他复制必须失败且保留既有内容，
缺少源码时同样明确失败。原生矩阵每次解析最新可用的 Node.js 24 patch，使构建行为
覆盖受支持运行时的当前实现。源码、包元数据、构建或依赖输入变化
需要更高 SemVer；构建清理脚本也属于发布输入。[CI 路由](../../README.md#ci-selection)
选中 CLI 时，全部原生检查和独立 shell completion 检查必须成功，PR 的 Linux CLI
任务还检查包版本；main push 保留全量应用门禁。最终 `checks` 只接受所有前置 job 的
`success` 或 `skipped`，失败、取消及其他结果使汇总失败。
发布在等待 CI 与安装依赖前检查精确版本的 tag 和 npm 记录；任一存在则成功跳过新发布。首次使用准备好的产物发布前重复检查，同一次 run 的发布失败重试
保留严格的源码、字节验证与补齐 tag 能力。
[版本预检决策](../../.agents/notes/implemented/process/2026-10-21-publication-version-preflight.md)
维护跳过与重试规则；发布授权、npm OIDC、产物身份及公共验证由
[发布决策](../../.agents/notes/implemented/process/2026-10-20-npm-trusted-publishing.md)维护。

## 验证与交付

根入口与每个命令的参数验证需覆盖正常调用、裸组、帮助、版本和错误结果；构建后入口
必须保留 shebang、bin 路径和版本输出。依赖隔离验证通过不可用的 SQLite 加载、缺失的
review 工具、无效或缺失配置，观察帮助、版本、补全生成和更新仍独立工作；配置保存不能进入
运行时，完成必要引导后的列表不能创建缺失状态、执行网络访问或获得 review 实例锁。
引导验证覆盖 TTY 与重定向 stdout、按能力提问、一次恢复、非交互诊断、取消与 EOF、
全部收集后保存、锁内重读及失败保留，并确认输入时间不消耗业务期限。

review 的原生 Git、SQLite、进程终止、APFS、调度与安装后完整生命周期工作负载保持
原有验收标准。独立构造的既有 YAML/SQLite fixture 验证命令重组后继续使用原有数据；
fixture 不能通过当前 store 生成基线，从而避免现有实现为自己证明兼容。具体业务验证
见[review 设计](daynight-review.md#验证与交付)。

自更新验收使用真实 npm、任务内隔离全局 prefix 和受控 HTTP registry，将 fixture 包从
`1.0.0` 更新为 `1.0.1`，检查安装归属、默认 prefix 改变、调用目录配置隔离、确切目标、
当前或领先版本、错误及 review 配置/状态保留。仅 fixture 安装被替换；不更改操作者的
全局 CLI。必须观测启动器、清单和新进程版本，验证搬迁后的 updater 仍从稳定入口接收
正确包目录。registry 访问和安装错误保持可见。

补全验证包括共享语法回归、编译后入口依赖隔离、脚本语法检查和真实 shell 交互。
`pnpm completion:acceptance` 在隔离启动文件的 PTY 中驱动 Bash 4.2、现代 Bash 和 zsh
的 Tab，检查实际插入文本、引号、后缀、描述和光标位置。它独立于 review 与自更新
安装验收。`completion setup` 验收在独立主目录中安装真实启动文件，检查 Bash 登录文件优先级、
zsh 目录选择、重复安装及启动后的注册与 Tab；使用任务内的 fixture，不修改
操作者的 shell 配置或全局安装。

GitHub Actions 保留原生 Linux、macOS、Windows 的普通测试与既有 review/update
安装验收，并在独立 Linux 作业中执行补全的真实 shell 验收。PT-T5 加入独立
project/task 安装 suite，以受控 HTTP 和真实 Git 证明三个原生平台的仓库选择与
文件行为；真实 Go/PostgreSQL 流程复用 Go command-package 的 fresh race binary。
服务验证的编排层只安装一次 CLI，原样执行 Go 覆盖率 gate，再在 Go 默认 10 分钟
计时器之外运行期限与真实解码字节预算探针。期限场景通过测试侧 preload 使用
1 秒单次、3 秒总期限，生产默认 30 秒/5 分钟单独断言；字节场景保留真实
128/256 MiB 边界和 +1 字节拒绝。职责与证据见
[project/task 设计](daynight-project-task.md#验证与交付证据)，当前状态仍由任务清单拥有。
[仓库验证说明](../../README.md#validation)定义本地及原生 receipt 的源码身份、
受控 GitHub/Copilot 行为与真实服务验收的证据边界。运行结果随对应 PR 与 CI 保存；
历史通过记录不能代替当前源码的验证结果。
