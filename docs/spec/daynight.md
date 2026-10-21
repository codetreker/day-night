# Daynight 客户端需求

状态：客户端入口、review、自更新、shell 补全、project 命令及配置、HTTP、仓库关联基础已实现；
task 命令、安装产物、真实服务及默认预算验收已完成并通过托管验证；
集成状态见[PR #55](https://github.com/codetreker/daynight/pull/55)。
可用命令和验证入口见[仓库 README](../../README.md)，完整交付范围见
[project/task 需求](daynight-project-task.md)及[任务清单](../design/daynight-project-task-tasks.md)。

Daynight 是一个组合命令的客户端工具包。npm 包提供统一的 `daynight` 入口，命令模块
拥有各自的业务行为、依赖和生命周期。`review` 是 GitHub PR 审查模块；`update` 管理
整个客户端的 npm 全局安装；`setup` 按能力保存配置；`completion` 生成 Bash 和 zsh
的原生补全脚本并安装启动配置；`skill` 安装随包分发的公开项目任务 skill。独立的 Go 服务和浏览器应用保留自己的产品需求
与生命周期。

本文档负责客户端入口、命令组合、按需配置引导、自更新和 shell 补全的必需行为；
[review 需求](daynight-review.md)负责审查、review 配置字段和持久化状态。
[project/task 需求](daynight-project-task.md)负责已确认的 server 连接配置、仓库关联
发现和远端项目任务命令。客户端机制见[架构设计](../design/daynight.md)，补全机制见
[补全设计](../design/daynight-completion.md)。公开 skill 的分发、交互安装和任务工作流
由[Agent skill 需求](daynight-agent-skill.md)拥有；各业务文档明确实际交付状态。

## 需求

### C1. 包与平台

npm 包名为 `@codetreker/daynight`，可执行命令为 `daynight`，TypeScript 应用代码放在
`packages/daynight/`。包的可执行入口固定为 `dist/main.js`。Linux、macOS 和 Windows
必须支持同一组命令和对应的业务保证；平台相关的命令执行、输出处理和退出行为必须
经过原生验证。shell 补全的运行环境由 C5 单独约束。

### C2. 命令组合与退出结果

客户端当前提供以下命令：

```text
daynight
daynight --help
daynight -h
daynight --version
daynight -v
daynight update
daynight setup
daynight setup --server-url <url>
daynight setup --review-repo <remote> [--review-path <path>]
daynight review
daynight review run
daynight review list
daynight review ls
daynight review add-repo <remote> [--path <path>]
daynight completion
daynight completion bash
daynight completion zsh
daynight completion setup [--shell bash|zsh] [--rc-file <path>]
daynight skill
daynight skill install
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
```

无参数、`--help` 或 `-h` 显示顶层帮助并成功退出；帮助列出 `review`、`update`、`setup`、
`completion`、`skill`、`project` 和 `task`。`--version` 与 `-v` 输出当前包版本。裸 `review` 和裸 `completion`
显示各自帮助；裸 `skill`、`project` 与 `task` 同样显示组帮助。组和操作在该层唯一参数为 `--help` 或 `-h` 时显示帮助，且不得执行
该操作。顶层版本选项不继承到子命令。`review ls` 是 `review list` 的别名。

`review add-repo` 的 `--path <path>` 可以位于 remote 前后，只能指定一次；不接受
`--path=value` 或 `--` 语法。未知命令、未知选项、多余参数或不完整参数必须输出
具体错误及对应帮助命令，以状态码 2 退出；操作失败以状态码 1 退出并保留具体原因。

服务命令的 text 选项接受分离值及 `--option=value`；内联形式按第一个 `=` 分隔，
保留后续 `=` 及值的前导连字符。分离形式拒绝前导 `-`；仅声明 `allowEmpty` 的
描述选项允许空字符串。标量选项不能重复，声明 repeatable 的依赖选项按输入顺序
保留全部值及重复 ID。状态候选和允许值均由同一命令定义拥有。开关、帮助和目录
选项不接受内联赋值；`--path=value` 无效。`project create` 接受一个必填位置参数
`<name>` 及可选 `--repo`；`--repo` 可在名称前后。省略时读取当前 Git worktree 的
有效 `origin`，显式提供时使用给定地址。只有该操作接受独立 `--` 结束选项解析，
前导 `-` 的名称可写成 `project create -- -name`，也可在终止符前指定 `--repo`。
旧的 `--daemon-review` 和顶层 `add-repo` 是无效参数，不能隐式重定向。

### C3. 命令依赖与持久化边界

顶层分发只依赖版本、包安装目录、输入输出、通用环境查询函数和轻量命令描述。
各命令可以提供不导入业务实现的定义模块，供参数校验、帮助和两种补全生成器共享
名称、别名、选项和值类型等语法事实；这些定义不能导入配置、文件系统探测、数据库、
外部适配器或运行时。只在选中的命令需要执行时加载该命令；命令内部只加载当前操作
所需的依赖。

根帮助、版本、任何命令帮助和补全脚本生成不解析用户主目录、不创建配置或状态、
不加载 SQLite，也不启动 Git、GitHub CLI、Copilot 或更新操作。补全生成还不得查询
工作目录、获取实例锁、读取审查状态或执行 npm 和网络请求。生成的脚本在按 Tab 时
遵守 C5 的本地执行要求。

`setup` 与 `review add-repo` 只写配置。按 C6 完成必要的配置引导后，
`review list` 与 `review ls` 只读取配置及已存数据库，
`review run` 独立持有审查运行时和信号生命周期，具体保证由 review 需求定义。
`project list/show` 和显式 `--repo` 的创建只加载 server 配置和 HTTP 能力；省略
`--repo` 的创建才加载 Git 发现当前 worktree 的有效 `origin`。所有 project 操作
均不读取或改写仓库本地关联、不写 ignore 规则。创建在完整分页比较仓库身份后，
仅无匹配时提交；唯一匹配成功返回既有 project，多匹配及查询失败均拒绝创建。
共享执行层在单个操作下处理信号、期限和完整结果输出。`task ready` 默认选择前
10 个 ready task，`--limit <N>` 接受十进制整数 `1..100`；它只请求一页，不遍历
后续 cursor。`task list` 继续读取全部匹配页。`ready` 的参数、服务排序及响应校验
由[project/task 需求](daynight-project-task.md#pt7-task-命令与更新语义)拥有。`task` 显式指定 project
时只需要 server 配置和 HTTP；自动选择时才加载 Git 与仓库关联模块。任务写入必须晚于本地
关联准备成功，完整行为由[project/task 需求](daynight-project-task.md)定义。
客户端的命令和源码结构调整不改变 review 配置与状态的现有格式和位置，不迁移、
重分区或重新初始化这些数据。新增命令通过自己的模块接入；它的业务依赖不能成为
其他命令的启动前提。[project/task 需求](daynight-project-task.md)规定服务 API
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

### C5. Bash 与 zsh 补全

`daynight completion bash` 为 Bash ≥4.2 生成原生补全脚本，`daynight completion zsh`
为已初始化 `compinit` 的 zsh 生成原生补全脚本。成功时 stdout 只能包含可加载的完整
脚本；未知 shell、多余参数和未知选项按 C2 拒绝。脚本必须显式注册 `daynight` 的
补全。zsh 缺少初始化时给出明确诊断并加载失败；Bash 低于版本下限时同样明确拒绝。
生成操作不修改 shell 启动文件。当前会话通过 `source <(daynight completion bash)`
或在 `compinit` 之后执行 `source <(daynight completion zsh)` 启用。持久安装由 C7
定义。包更新后，新 shell 使用当前安装的定义；已有 shell 重新加载脚本后刷新。
保存的脚本文件需要重新生成。

补全覆盖命令、子命令、别名、当前层的选项、`completion` 的 shell 参数和
`review add-repo --path` 与 `setup --review-path` 的目录候选；zsh 同时展示候选说明。非重复选项使用后不再
提供，已消耗的位置参数不重复提供候选，remote 不提供远端候选或无关文件候选。
目录建议不约束运行时合法值，操作者仍能输入尚未创建的目标目录。状态的静态
候选为 `todo`、`in_progress`、`done`，分离及内联形式使用同一候选。重复依赖选项
使用后仍可继续补全；自由文本、project/task ID 和依赖 ID 不回落文件候选。空描述
和已完成内联值之后，后续选项按共享语法继续补全。

按 Tab 只执行 shell 本地补全和目录枚举，不启动 Node 或其他 daynight 进程，不读取
review 配置或数据库，不访问网络。候选和输入必须作为数据处理，不作为 shell 代码
执行。补全必须保留空格、中文、引号及特殊字符目录，处理远程地址的冒号和光标位于
行中的情况，且不改变用户全局的分词配置或 completion style。当前脚本按 source
加载；不承诺将同一输出直接用于 zsh `fpath` 自动加载。

### C6. 按需配置引导

`project` 和 `task` 的有效业务调用只要求服务连接配置；`review run`、`review list`
及 `review ls` 只要求 review 配置。机器仅使用 project/task 时，可以一直只有
`serverUrl`，无需登记 review 仓库。各能力不共享“初始化完成”状态。

当前命令缺少配置文件，或严格解析成功后缺少其必需字段时，若 stdin 与 stderr 均为
TTY，必须询问所缺配置。服务命令只询问 `serverUrl`；review 只询问一个 GitHub 远程
地址及可选本地克隆路径，复用仓库登记规则。当前能力已有的无效字段值、review 的
空仓库列表、共享 YAML 语法或结构错误、重复键、未知字段和读取权限错误仍须显示
原因；不得通过引导覆盖或修复这些输入。其他能力的业务字段值继续由其独立投影
校验，不能阻塞当前能力。
配置修改继续拒绝符号链接和其他非普通文件。配置完整时不询问。

`daynight setup` 无选项时让操作者选择服务连接、review 或两者，再收集所选值。
显式 `--server-url <url>`、`--review-repo <remote>` 可单独或同时使用，仅设置选中的
能力且不询问；`--review-path <path>` 必须与 `--review-repo` 一起使用。远程地址和
路径语义与 `review add-repo` 相同；服务地址使用 PT2 的校验规则且没有隐含默认值。
非交互调用缺少必要配置时，立即以状态码 1 失败，给出可执行的对应 setup 命令。

提示、保存结果和取消诊断只写 stderr，业务结果保留 stdout 的原有格式，包括 JSON。
必须先收集全部输入，再持配置写锁重新读取文件、合并所选字段、校验并原子保存；
保留其他能力的字段、YAML 注释、已有仓库路径和文件权限。并发完成的无关字段修改
必须保留；所选字段在收集输入期间变化时，明确报冲突并要求重新设置，不能覆盖。
已有配置写锁被占用时明确失败。

输入结束、Ctrl+C、SIGTERM 或 Windows SIGBREAK 取消尚未完成的引导；取消时不保存
部分输入，也不执行原业务。引导不访问网络、不检查认证、不 clone、不初始化 SQLite
或审查运行时。自动引导保存成功后，原命令以原参数执行且只执行一次；后续连接或运行
失败保留已保存的配置。人工输入时间不计入业务命令期限。帮助、版本、补全、自更新及
无效参数不触发引导。

### C7. 补全启动配置安装

`daynight completion setup` 必须检查调用者的 Bash 或 zsh 启动配置，缺少加载配置时
自动安装。默认依据实际进程关系尽力识别正在调用的 shell，不能把 `SHELL` 的登录
偏好当作当前 shell。无法可靠识别时明确失败并提示 `--shell bash|zsh`；显式 shell
选择优先于自动识别。`--rc-file <path>` 指定自定义启动文件，只检查和修改该文件。
帮助及无效参数必须在启动文件 I/O 前处理；无效 shell、重复或缺失选项值按 C2
退出 2；无法识别调用者时同样给出显式选择的用法错误，进程查询或文件操作失败
退出 1 并保留具体原因。

默认 Bash 安装必须覆盖交互式非登录 shell 的 `.bashrc`，以及登录 shell 按
`.bash_profile`、`.bash_login`、`.profile` 优先级实际选择的首个可读已有文件；只有
三者均不存在时创建 `.bash_profile`。已有文件全部不可读时明确失败，不能通过创建
更高优先级文件屏蔽已有配置。
登录加载块只在交互式 Bash 中执行，语法必须允许 `.profile` 被其他 POSIX shell
读取。安装不得为启用补全而执行 `.bashrc` 的其他配置。

默认 zsh 安装使用导出的 `ZDOTDIR` 下的 `.zshrc`，`ZDOTDIR` 未设置时使用主目录；
导出空值时目标为 `/.zshrc`，相对值按 setup 当前工作目录解析，不能将空值
当作当前目录或未设置处理。之后 zsh 从其他目录启动时，其相对目录也随启动目录
改变。未导出的自定义目录通过 `--rc-file` 指定。
加载块复用已初始化的补全系统，缺少时运行保留正常安全检查的 `compinit`；不能
跳过不安全目录检查或自动接受其风险。

安装必须识别已有管理块及文档中的标准独立加载语句，避免重复添加。管理块在每次
启动时检查该 shell 中 daynight 的实际补全注册，缺少时才加载；登录与非登录启动
文件相互加载时，管理块不得对已有注册重复生成。保留的手写加载语句保持其原有
执行语义，无条件语句在管理块之后执行时仍会再次加载。已经安装的文件再次执行
`completion setup` 时字节保持不变。既有内容的字节、换行、权限和符号链接身份
必须保留；新管理块使用 shell 可解析的 LF 换行，无末尾换行时先追加 LF 分隔。
管理块不完整或重复、目标不是普通文件、权限不足等情况必须明确失败；不能输出
安装成功来掩盖错误。

成功输出必须区分启动配置已安装与已存在，并明确当前会话的启用方式。
`completion setup` 只安装持久配置，不执行用户启动文件，不宣称已读取或修改父
shell 的内存状态；输出对应的既有 `source <(daynight completion bash|zsh)` 命令供当前会话启用。启动文件中的任意提前
返回、条件分支或后续清理可能阻止加载，安装检查不承诺证明这些自定义逻辑的效果。
管理块在新 shell 启动时调用当前安装版本的脚本生成入口；生成、加载或初始化失败
必须以非零状态暴露，不注册声称可用的补全。C5 的 Tab 本地执行保证继续成立。
安装不读取 review 配置、数据库或远端服务。

## 验收场景

| 场景 | 必需结果 | 对应需求 |
|---|---|---|
| 无配置、SQLite 不可加载且 PATH 缺少 review 工具时调用根帮助或版本。 | 输出帮助或当前包版本，退出 0，未解析用户主目录或触及 review 数据。 | C1, C2, C3 |
| 调用裸 `review`、裸 `completion`、组帮助或任何操作帮助。 | 显示对应帮助，退出 0，未进入业务操作或加载审查运行时。 | C2, C3 |
| 调用未知根命令、旧入口、不完整参数或未知操作选项。 | 输出错误及对应帮助命令，退出 2；未执行配置、审查或更新。 | C2, C3 |
| 在 remote 前后使用一次 `--path`，或重复、合并赋值、混用帮助及其他参数。 | 合法顺序保持等价；重复 `--path`、`--path=value`、`--` 和非唯一帮助参数退出 2。 | C2 |
| 首次在 TTY 执行有效 project/task 或 review 业务操作。 | 仅询问当前能力的缺失字段，保存后以原参数执行一次；JSON stdout 不含提示。 | C6 |
| 仅配置服务地址，或只配置 review 仓库。 | 对应命令直接运行；首次使用另一能力时才补充其配置，保留已有字段和注释。 | C3, C6 |
| 主动选择 setup 的两种能力，或通过显式选项配置。 | 全部值收集、校验后一次原子保存；显式选项不询问，review 路径必须伴随仓库地址。 | C6 |
| 非 TTY 缺配置、已有配置损坏、读取失败，或在引导期间取消及 EOF。 | 缺配置给出脚本配置命令；损坏及读取错误保留原因；取消不保存部分值且不执行业务。 | C6 |
| 引导期间另一配置命令已写入，或配置锁被占用。 | 保存前重读并保留无关字段修改；所选字段已变更或占锁时明确失败且不执行业务。 | C6 |
| 执行 review 的配置、列表和运行操作。 | 按操作加载其依赖，复用原有 YAML 和 SQLite；审查保证见 review 的 R1–R15。 | C3 |
| 执行 `daynight update`，registry 的 `latest` 比当前版本更新。 | 只更新当前 npm 全局安装，安装已查询到的确切版本，重新验证清单、启动器和新进程版本后报告成功；保留配置及审查状态。 | C4 |
| npm 默认全局 prefix 已变化，或调用目录包含项目 `.npmrc`。 | 仍使用当前安装的实际 prefix，保留用户/全局 registry 与认证配置，不更新其他 prefix，也不使用调用目录的项目配置。 | C4 |
| 当前版本等于或高于 `latest`，或从安装目录内部执行命令。 | 当前或领先版本不安装、不降级；需要安装且调用目录在包内时明确拒绝。 | C4 |
| 从源码、本地依赖、`npx`、pnpm 或 `npm link` 安装调用更新。 | 拒绝并给出原包管理器指引，不创建另一份全局安装。 | C4 |
| 无配置文件时执行更新帮助，或更新遇到无效参数、网络、权限、engine 或安装后验证失败。 | 帮助不更新；无效参数退出 2；操作失败退出 1 并保留原因；不触及配置、SQLite、实例锁、会话和 review 工具。 | C4 |
| 已有 reviewer 运行时更新成功，或 Windows 原生文件被占用导致安装失败。 | 成功后提示手动重启 reviewer；占用导致的 npm 错误明确失败，不宣告已经更新。 | C4 |
| 隔离 review 配置、SQLite 和外部工具后生成两种脚本，或请求未知 shell、多余参数。 | 有效请求只输出脚本，未查询用户目录/工作目录或触及业务依赖；无效请求退出 2 并指向补全帮助。 | C2, C3, C5 |
| 在真实 Bash 4.2、现代 Bash 和 zsh 中加载脚本并按 Tab。 | 命令、别名、选项和 shell 候选符合共享语法；zsh 展示说明；无需 Node、review 数据或网络。 | C3, C5 |
| 补全带空格、中文、引号、美元符号的目录，remote 带冒号，或光标位于行中。 | 插入文本、引号、目录后缀与下一参数位置正确；输入不被执行，后方参数不改变当前位置。 | C5 |
| 已使用 `--path`、已填 remote、目标目录不存在，或本地目录与命令同名。 | 选项和参数不重复；remote 不回落文件候选；不存在目录仍可手动输入；同名目录不破坏命令插入及分隔符。 | C2, C5 |
| 未初始化 zsh 补全系统或使用 Bash 3.2 加载脚本。 | 加载失败并显示对应前提，不宣告补全已经可用。 | C5 |
| 自动识别 Bash/zsh，或显式指定 shell、自定义启动文件。 | 选择实际 shell 对应的文件；识别不可靠时提示显式选择；自定义路径只管理指定文件。 | C7 |
| Bash 有不同优先级的登录文件，或安装到被其他 POSIX shell 读取的 `.profile`。 | 保留既有登录文件选择，只在交互式 Bash 中启用；非 Bash 读取不产生语法错误。 | C7 |
| zsh 使用主目录、导出绝对、相对或空 `ZDOTDIR`，或已初始化补全系统。 | 未设置使用主目录，相对值按 setup 工作目录解析，空值指向 `/.zshrc`；缺少初始化时保留安全审查，已有初始化被复用。 | C7 |
| 首次 setup 后重复安装，或含管理块的启动文件相互加载。 | 首次缺少时安装；再次安装文件字节不变；管理块对已有注册不重复加载，真实 shell 能按 Tab；保留的无条件手写语句继续按原顺序执行。 | C5, C7 |
| 已有标准手写加载语句、符号链接、CRLF 或没有末尾换行的启动文件。 | 复用标准配置，保留既有内容的字节、换行、权限和链接身份；新块使用 LF，真实 shell 可加载管理块并按 Tab。 | C7 |
| 管理块损坏、目标不是普通文件、权限不足，或用户启动逻辑提前返回。 | 文件错误明确失败；安装不执行用户配置，不将配置存在等同于当前 shell 已加载。 | C7 |
