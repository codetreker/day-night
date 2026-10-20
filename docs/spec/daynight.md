# Daynight 客户端需求

状态：客户端入口、review、自更新及 project/task 的配置、HTTP 和仓库关联基础已实现；
project/task 命令与完整服务验收待完成。
可用命令和验证入口见[仓库 README](../../README.md)，待实现范围见
[project/task 需求](daynight-project-task.md)及[任务清单](../design/daynight-project-task-tasks.md)。

Daynight 是一个组合命令的客户端工具包。npm 包提供统一的 `daynight` 入口，命令模块
拥有各自的业务行为、依赖和生命周期。`review` 是 GitHub PR 审查模块；`update` 管理
整个客户端的 npm 全局安装。独立的 Go 服务和浏览器应用保留自己的产品需求与生命周期。

本文档负责客户端入口、命令组合和自更新的必需行为；[review 需求](daynight-review.md)
负责审查、review 配置字段和持久化状态。[project/task 需求](daynight-project-task.md)
负责已确认的 server 连接配置、仓库关联发现和远端项目任务命令。客户端机制见
[架构设计](../design/daynight.md)；各业务文档明确其实际交付状态。

## 需求

### C1. 包与平台

npm 包名为 `@codetreker/daynight`，可执行命令为 `daynight`，TypeScript 应用代码放在
`packages/daynight/`。包的可执行入口固定为 `dist/main.js`。Linux、macOS 和 Windows
必须支持同一组命令和对应的业务保证；平台相关的命令执行、输出处理和退出行为必须
经过原生验证。

### C2. 命令组合与退出结果

客户端当前提供以下命令：

```text
daynight
daynight --help
daynight -h
daynight --version
daynight -v
daynight update
daynight review
daynight review run
daynight review list
daynight review ls
daynight review add-repo <remote> [--path <path>]
```

无参数、`--help` 或 `-h` 显示顶层帮助并成功退出；帮助列出 `review` 和 `update`。
`--version` 与 `-v` 输出当前包版本。裸 `review` 显示组帮助。组和操作的帮助不得执行
该操作。`review ls` 是 `review list` 的别名。未知命令、未知选项或不完整参数必须
输出具体错误及对应帮助命令，以状态码 2 退出；操作失败以状态码 1 退出并保留具体原因。
旧的 `--daemon-review` 和顶层 `add-repo` 是无效参数，不能隐式重定向。

### C3. 命令依赖与持久化边界

顶层分发只依赖版本、包安装目录、输入输出、通用环境查询函数和命令描述；不能加载
或解析 review 配置、路径、数据库、外部适配器或运行时。只在选中的命令需要执行时加载该命令；命令内部
只加载当前操作所需的依赖。根帮助、版本和任何命令帮助不解析用户主目录、不创建
配置或状态、不加载 SQLite，也不启动 Git、GitHub CLI、Copilot 或更新操作。

`review add-repo` 只写配置，`review list` 与 `review ls` 只读取配置及已存数据库，
`review run` 独立持有审查运行时和信号生命周期，具体保证由 review 需求定义。
客户端的命令和源码结构调整不改变 review 配置与状态的现有格式和位置，不迁移、
重分区或重新初始化这些数据。新增命令通过自己的模块接入；它的业务依赖不能成为
其他命令的启动前提。[project/task 需求](daynight-project-task.md)规定待实现的服务 API
命令；其独立配置校验、仓库本地关联和远端操作继续遵守这些加载与数据归属要求。

### C4. 自更新

`daynight update` 查询当前 npm 配置的 registry 中 `@codetreker/daynight` 的 `latest`
版本，并在该版本的 SemVer 优先级高于当前版本时更新正在执行的 npm 全局安装。
安装使用已查询到的确切版本；查询后的 `latest` 变化不能改变本次目标。已安装版本与
`latest` 相同或优先级更高时成功退出，不执行安装，也不降级。

命令必须确认当前包的真实路径符合 npm 全局目录结构，且该安装的 `daynight` 启动器
确实指向当前包。使用该安装的实际 prefix 进行查询与安装，不能因当前 npm 默认 prefix
变化而更新另一份副本。用户和该 prefix 的全局 npm registry、认证配置继续生效；
调用目录的项目 `.npmrc` 不参与全局更新。源码、本地依赖、`npx`、pnpm 及 `npm link`
安装必须拒绝自更新并给出使用原包管理器的指引，不能另外创建一份全局安装来宣告成功。

查询和安装通过当前 Node.js 运行 npm 的 JavaScript 入口。安装实时转发输出，强制校验
目标包的 Node.js engine，不能自动提升权限。需要安装且调用目录位于被替换包内部时，
必须明确要求从安装目录之外重试；仅查询得到当前或领先版本时允许在包内成功返回。
安装后必须重新读取包身份和版本、验证启动器，并通过该安装的绝对 CLI 路径在新进程中
检查 `--version`，全部匹配目标版本后才能报告更新成功。npm 负责文件替换和安装恢复；
命令不承诺原子回滚，失败也不保证原安装的全部字节保持不变。

`daynight update --help` 和 `daynight update -h` 显示帮助且不执行更新；其他参数以
状态码 2 拒绝。查询、权限、网络、engine、安装或验证失败以状态码 1 退出并保留错误
原因。命令无需配置文件，不解析用户主目录、不加载 review 配置或运行时、不打开
SQLite、不获取实例锁、不修改审查会话，也不调用 Git、GitHub CLI 或 Copilot。

更新成功后，下一次 CLI 调用使用新版本；正在运行的 reviewer 必须由操作者重启。
命令不自动停止或重启它。Windows 上运行中的 reviewer 可能占用原生 addon 文件，导致
npm 替换失败；该失败必须明确报告。

## 验收场景

| 场景 | 必需结果 | 对应需求 |
|---|---|---|
| 无配置、SQLite 不可加载且 PATH 缺少 review 工具时调用根帮助或版本。 | 输出帮助或当前包版本，退出 0，未解析用户主目录或触及 review 数据。 | C1, C2, C3 |
| 调用裸 `review`、组帮助或任何操作帮助。 | 显示对应帮助，退出 0，未进入业务操作或加载审查运行时。 | C2, C3 |
| 调用未知根命令、旧入口、不完整参数或未知操作选项。 | 输出错误及对应帮助命令，退出 2；未执行配置、审查或更新。 | C2, C3 |
| 执行 review 的配置、列表和运行操作。 | 按操作加载其依赖，复用原有 YAML 和 SQLite；审查保证见 review 的 R1–R15。 | C3 |
| 执行 `daynight update`，registry 的 `latest` 比当前版本更新。 | 只更新当前 npm 全局安装，安装已查询到的确切版本，重新验证清单、启动器和新进程版本后报告成功；保留配置及审查状态。 | C4 |
| npm 默认全局 prefix 已变化，或调用目录包含项目 `.npmrc`。 | 仍使用当前安装的实际 prefix，保留用户/全局 registry 与认证配置，不更新其他 prefix，也不使用调用目录的项目配置。 | C4 |
| 当前版本等于或高于 `latest`，或从安装目录内部执行命令。 | 当前或领先版本不安装、不降级；需要安装且调用目录在包内时明确拒绝。 | C4 |
| 从源码、本地依赖、`npx`、pnpm 或 `npm link` 安装调用更新。 | 拒绝并给出原包管理器指引，不创建另一份全局安装。 | C4 |
| 无配置文件时执行更新帮助，或更新遇到无效参数、网络、权限、engine 或安装后验证失败。 | 帮助不更新；无效参数退出 2；操作失败退出 1 并保留原因；不触及配置、SQLite、实例锁、会话和 review 工具。 | C4 |
| 已有 reviewer 运行时更新成功，或 Windows 原生文件被占用导致安装失败。 | 成功后提示手动重启 reviewer；占用导致的 npm 错误明确失败，不宣告已经更新。 | C4 |
