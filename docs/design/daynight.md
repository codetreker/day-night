# Daynight 客户端架构设计

状态：`packages/daynight/` 是通过 `@codetreker/daynight` 分发的 TypeScript 客户端
命令工具包，支持 Linux、macOS 和 Windows。`review` 提供 GitHub PR 审查，`update`
管理当前 npm 全局安装，`completion` 生成 Bash 和 zsh 的原生补全脚本。行为归属见
[客户端需求](../spec/daynight.md)及
[review 需求](../spec/daynight-review.md)，结构选择见
[命令组合决策](../../.agents/notes/implemented/architecture/2026-10-20-client-command-composition.md)。
[补全设计](daynight-completion.md)拥有共享语法描述、脚本生成和 shell 加载机制。

## 命令与职责

```text
daynight                            # 顶层帮助
daynight --help                      # 同 -h
daynight --version                   # 同 -v
daynight update
daynight review                     # review 帮助
daynight review run
daynight review list                 # 同 review ls
daynight review add-repo <remote> [--path <path>]
daynight completion                 # 补全帮助
daynight completion bash
daynight completion zsh
```

各组和操作在该层唯一参数为 `--help` 或 `-h` 时显示帮助。顶层无参数显示帮助，
未知命令与无效参数退出 2，业务执行失败退出 1 并保留原因。旧的 `--daemon-review` 和顶层 `add-repo` 不再是
有效命令。review 操作沿用[review 设计](daynight-review.md)的配置、持久化和运行保证。

客户端外壳处理顶层帮助、版本、命令选择及通用退出结果。每个命令模块负责自己的
定义、参数、帮助、依赖和执行生命周期。`review` 再按配置登记、本地列表、前台运行分派，
避免查询或配置操作初始化审查运行时。`update` 属于包安装生命周期，不属于 review。
独立 Go 服务与浏览器应用保持各自的数据和生命周期，客户端不因命令组合结构自动
获得服务 API 或其他业务命令。

## 源码组织

```text
src/
  main.ts
  cli/
    application.ts
    commands.ts
    context.ts
    schema.ts
  commands/
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
      bash.ts
      zsh.ts
  platform/
    diagnostics.ts
    filesystem.ts
```

`main.ts` 是稳定的可执行入口，向应用传递包版本和从该入口确定的包目录；编译后仍为
`dist/main.js`。`cli/context.ts` 只描述客户端上下文：版本、包目录、输入输出，以及
用户主目录和工作目录的惰性查询函数；不放入已解析的 review 路径、配置或运行函数。
`cli/commands.ts` 组合各命令的轻量定义并保存异步执行入口；`cli/application.ts`
只在选中命令时调用加载函数。`cli/schema.ts` 定义命令、别名、选项和值类型、位置
参数及固定候选，并由它完成参数校验与帮助渲染。各 `definition.ts` 不导入业务实现、
配置、文件系统探测、原生数据库或适配器；根分发可以读取这些定义而不加载业务。
Bash 和 zsh 生成器消费同一命令树，避免解析、帮助和补全分别维护语法。增加业务
命令需要登记入口和实现自己的模块，顶层分发不认识该命令的业务依赖。

命令组先完成参数和帮助分派，再按操作加载默认实现。裸命令、帮助、版本及无效参数
无需解析用户主目录、打开数据库或调用外部程序。补全生成同样不查询工作目录、
review 状态或网络。`review add-repo` 加载配置保存能力，列表加载配置解析与只读快照，`review run` 才加载运行时、信号处理、实例锁和适配器。
该顺序也使自更新进程不加载待替换的 SQLite 原生 addon。

review 的配置和路径类型明确以 `ReviewConfiguration`、`ReviewPaths` 命名。
`commands/review/model.ts` 持有领域和安全恢复证明类型，store 专注持久化；
`polling.ts` 组合远端只读观测与本地原子状态提交，GitHub 适配器专注远端查询。
[review 模块职责表](daynight-review.md#单进程与普通模块)解释具体职责及执行不变量。
共享的 `platform/` 只承载诊断和文件系统能力；这些函数不导入命令模块。

源码测试按 `test/cli/`、`test/commands/review/`、`test/commands/update/`、
`test/commands/completion/` 和 `test/platform/` 镜像职责，构建与版本策略测试位于
`test/tooling/`，共享 fixture 与帮助函数保持明确归属。使用普通函数和具体类型；外部命令、时钟与故障点只在有实际
验证需求的边界注入，不增加通用插件框架或依赖注入容器。

## Shell 补全

`commands/completion/` 通过共享命令树生成 Bash ≥4.2 和 zsh 的原生脚本；有效生成请求
只向 stdout 写入脚本。裸 `completion` 及其帮助只显示使用说明，错误 shell 或无效
参数沿用状态码 2。脚本生成不读取配置和状态，不加载 review 或更新业务。

脚本在 source 时注册 `daynight` 补全，Bash 检查版本下限，zsh 要求调用者已完成
`compinit`，缺少初始化时明确报错并加载失败。按 Tab 时只使用 shell 内存中的语法
和本地目录枚举，不启动 Node、
daynight 或网络请求。参数语法保留原有唯一帮助参数、remote 前后一次 `--path`、
不接受 `--path=value` 或 `--` 的规则。目录候选保留实际参数边界，且不限制尚未
创建的路径输入。生成和加载机制、引号与光标处理由[补全设计](daynight-completion.md)
统一说明，启用命令由[README](../../README.md#shell-completion)拥有。

[补全决策](../../.agents/notes/implemented/feature/2026-10-20-shell-completion.md)
记录 Bash 下限、zsh 原生集成和本地执行的成本。脚本输出用于 source；zsh `fpath`
自动加载需要不同的装载形式，未包含在该输出的使用承诺中。

## 配置与持久化

review 的配置仍为 `~/.daynight/config.yml`，SQLite 仍为 `~/.daynight/state.sqlite`；
会话、锁、日志、缓存和临时文件仍在同一状态目录，PR worktree 仍位于各仓库的
`.worktrees/`。既有 YAML 字段和 SQLite 版本 1 表结构保持原样，不新增命令分区或
迁移。业务模块归属与磁盘目录归属分别管理：源码整理不会改变已保存路径、永久 PR
边界、修订、会话 UUID、重试预算或 worktree 身份。详细格式、验证、锁及恢复规则由
[review 设计](daynight-review.md#本地数据与-sqlite)统一定义。

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
生成产物，防止模块移动后保留旧的可执行文件。清理脚本从自身位置定位目标目录，
调用者工作目录不会改变清理位置。包的 bin 及发布入口保持 `dist/main.js`。

普通测试先构建包，既验证源码职责，也通过编译产物验证公开命令。`pnpm typecheck`、
`pnpm test`、`pnpm build`、独立 `pnpm acceptance` 和 `pnpm completion:acceptance`
的实际入口由
[README](../../README.md#cli-development)维护。源码、包元数据、构建或依赖输入变化
需要更高 SemVer；构建清理脚本也属于发布输入。Linux 版本检查和全部原生检查共同
构成必需门禁。发布授权、npm OIDC、产物身份及恢复规则继续由
[发布决策](../../.agents/notes/implemented/process/2026-10-20-npm-trusted-publishing.md)维护。

## 验证与交付

根入口与每个命令的参数验证需覆盖正常调用、裸组、帮助、版本和错误结果；构建后入口
必须保留 shebang、bin 路径和版本输出。依赖隔离验证通过不可用的 SQLite 加载、缺失的
review 工具、无效或缺失配置，观察帮助、版本、补全生成和更新仍独立工作；配置保存不能进入
运行时，列表不能创建缺失状态、执行网络访问或获得 review 实例锁。

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
安装验收，使用任务内的 fixture，不修改操作者的 shell 配置或全局安装。

GitHub Actions 在原生 Linux、macOS、Windows 上运行普通测试与两套安装验收，
并在独立 Linux 作业中执行补全的真实 shell 验收。
[验收报告](../research/daynight-acceptance.md)区分每次已观察到的本地及原生 receipt、
受控 GitHub/Copilot 行为与真实服务验收；历史通过记录不能代替当前源码的验证结果。
