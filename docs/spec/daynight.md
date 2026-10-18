# Daynight 需求

状态：产品范围已确认。已实现范围和可用命令见[仓库 README](../../README.md)。

Daynight 是一个在前台持续运行的 CLI，负责监控配置的 GitHub 仓库，并在符合条件的
PR 需要审查时启动 review agent。daemon 是这个 CLI 进程承担的角色。该进程维护仓库
副本、worktree、审查会话，以及持久化的调度状态。agent 审查代码，并自行将审查结果
发布到 GitHub。

本文档负责定义必需行为和验收场景。架构文档负责说明满足这些需求的机制。

## 需求

### R1. 包与运行方式

npm 包名为 `@codetreker/daynight`，可执行命令为 `daynight`，应用代码放在
`packages/daynight/`，使用 TypeScript 编写。
工具在 Linux、macOS 和 Windows 上通过 `daynight --daemon-review` 以单个前台 CLI
启动，并持续运行直到被停止。CLI 负责轮询、维护 SQLite 状态、管理 worktree，并直接
将 Copilot 作为子进程启动。
三个平台必须支持相同的仓库、监控、会话、worktree、完成判定和恢复行为。必须在每个
平台上验证子进程调用、输出处理和正常退出。review agent 按前台程序契约执行，
返回前必须结束自己启动的工具和服务；异常退出后不能仅凭保存的 PID 推断旧执行已停止。

### R2. 仓库配置

配置文件固定为 `~/.daynight/config.yml`，使用 YAML，通过远程地址和本地仓库路径
指定每个需要监控的 GitHub 仓库。`~` 表示当前操作系统用户的主目录，路径由程序解析；
从不同工作目录启动都读取同一份配置。手写的仓库路径为相对路径时，相对于配置文件
所在目录解析；每个仓库必须具有 `path`。并发审查 Worker 数量的配置项名为
`maxConcurrentWorker`。每个配置的仓库分别维护自己的初始化状态和 PR 状态。

`daynight add-repo <remote> [--path <path>]` 负责读取、校验和保存配置。配置不存在时
自动创建；已有配置中的其他设置和 YAML 注释须保留。命令不执行 clone、认证检查、
GitHub 查询、SQLite 初始化或 PR 初始化。运行中的 daemon 在下次启动时读取新配置；
添加成功只表示配置已保存。

顶层 `repositoryRoot` 默认是 `~/daynights`，仅在添加仓库且省略 `--path` 时用于决定
路径。命令按规范化的 host/owner/name 生成路径，并将结果作为绝对路径写入该仓库的
`path`。显式 `--path` 相对于命令的当前工作目录解析，同样保存为绝对路径。
修改 `repositoryRoot` 不改变任何已有仓库的路径；运行时只使用每个仓库的 `path`。

重复添加同一规范化仓库时，省略 `--path` 就复用已保存的路径，不受根目录变更影响；
显式指定同一实际路径同样成功且不修改配置，显式指定不同路径则报错。必须校验完整
结果并防止并发添加覆盖另一项修改。校验或替换前的写入失败须保留已有配置；替换后的
清理错误仍须明确可见。

### R3. 本地仓库与认证

启动时，daemon 确保每个配置的仓库都已 clone 到指定的本地路径。仓库缺失时，daemon
负责 clone。本地克隆和 review worktree 是本系统专用的审查环境，不承担人工开发或
其他工具的用途。GitHub CLI 认证由运行环境在 daemon 启动前准备好。

### R4. 永久初始化边界

每个仓库首次初始化时，daemon 将已有 PR 的最大编号记录为该仓库的 `Start PR No`。
这个边界涵盖所有状态的已有 PR，包括 Draft、Open、Closed 和 Merged。

编号小于或等于 `Start PR No` 的 PR 永久排除在审查范围之外。后续提交、ready 状态
变化、目标分支变化或重新打开，都不会使这些 PR 获得审查资格。边界只持久化一次，
daemon 重启后复用原值；重启不会建立新边界。

### R5. 轮询与审查资格

daemon 按间隔持续轮询配置的仓库。只有同时满足以下条件的 PR 才能被审查：

- 编号大于所属仓库的 `Start PR No`。
- 状态为 Open。
- 不是 Draft，即已 ready for review。

daemon 会跟踪 Draft PR，使其转为 ready 后能够获得审查资格。PR 处于 Draft 或关闭
状态时，不得启动审查。

### R6. 审查触发条件

对于编号超过边界的 PR，观察到以下任一情况时，只要满足 R5 的审查资格条件，就需要
进行审查：

- 新发现的 PR 已经 ready for review。
- PR 的 head SHA 变化，包括新增提交或 force push 后的变化。
- PR 从 Draft 转为 ready for review。
- PR 修改目标分支。

仅目标分支新增提交不触发审查。PR 处于 Draft 时发生的变化，必须等到 PR 转为 ready
后才能触发审查。

### R7. 单个 PR 的执行顺序

同一 PR 在任一时刻最多运行一个 review agent。正在审查时观察到的、需要审查的新
变化，必须保持待处理状态，留待后续审查。待处理变化可以合并，使后续审查针对最新且
符合审查资格的状态进行。

### R8. 持久化 agent 会话

daemon 调用 Copilot CLI 作为本地 review agent。每个被审查的 PR 对应一个持久化的
CLI 会话。该 PR 的每次后续审查，以及每次确认或重试，都必须恢复同一个会话，以保持
审查上下文连续。会话标识在 daemon 重启后保留。

### R9. Worktree 管理职责与生命周期

每个被审查的 PR 使用独立的 Git worktree，放在所属仓库根目录的 `.worktrees/` 下。
daemon 在首次审查时创建 worktree，并在该 PR 的后续审查中复用。daemon 负责这些
worktree 的创建、准备、更新和清理；review agent 不负责 worktree 管理。

PR 合并或未合并就被关闭时，daemon 清理其 worktree。deprecated PR 指未合并就被
关闭的 PR。worktree 内的文件、嵌套仓库及其所属管理数据均为可丢弃的审查内容；
新修订准备和关闭清理可以清除这些内容，同一目标的确认或重试保留已有上下文。

### R10. 审查判断与结果发布

agent 负责审查，并直接将结果发布到 GitHub：

- 发现 Critical 或 Major 问题时，在相关代码行发布 inline review comments，不提交
  `REQUEST_CHANGES`。
- 没有发现 Critical 或 Major 问题时，approve 该 PR。

daemon 不代替 agent 发布审查结果，也不通过解析 JSONL 或结构化 findings 来决定
发布内容。

### R11. 文本完成协议

agent 完成审查及所需的 GitHub 发布操作后，标准输出的最后一个非空行必须严格为：

```text
PR <number> Review Completed
```

`<number>` 是当前审查的 PR 的十进制编号，例如 `PR 123 Review Completed`。这一行
必须独立存在，不附带其他格式。daemon 在 agent 进程结束后检查此行。其他 PR 的标记、
不完整的标记，或者标记之后还有其他非空行，都不满足协议。agent 只能在所需的 GitHub
操作成功后输出标记。

### R12. 确认与重试

agent 结束时如果缺少所需的完成标记，daemon 恢复同一个会话，请求确认或重试。
agent 首先判断上次尝试是否已经发布了所需结果。如果已经发布完成，就输出标记确认
完成；否则完成剩余工作。重试发布前，agent 核对先前在 GitHub 上产生的效果，避免
明知同一审查结果已经发布却再次发布。完成标记表示 agent 声明所需操作已成功；GitHub
发布与 SQLite 状态变更并非同一个原子操作。

### R13. 持久化状态与重启

SQLite 数据库位于 `~/.daynight/state.sqlite`。数据库、会话文件、实例锁、日志、缓存
和临时文件统一保存在 `~/.daynight/`。PR worktree 按 R9 放在所属仓库根目录的
`.worktrees/` 下，仓库克隆位置由配置中的本地路径指定。SQLite 保存恢复仓库监控和
审查执行所需的持久化状态，包括仓库初始化边界、已观察到的 PR 状态、目标分支和
head SHA、已审查版本、CLI 会话标识、worktree 标识、执行状态，以及确认或重试状态。

重启后，daemon 根据这些状态恢复待处理或被中断的工作，同时保留 R4 规定的永久排除
规则和 R8 规定的单个 PR 会话连续性。不得仅因 daemon 已经重启，就将被中断的尝试视为
完成。

### R14. 审查版本归属

每次审查尝试及其完成状态，都关联到该次尝试被要求审查的 PR 版本。完成针对某个 head
SHA 的尝试，不能满足另一个 head SHA 的待处理审查。同样，完成一次尝试也不会清除
后续 ready 状态转换或目标分支变化产生的待处理触发事件。

### R15. 本地审查状态列表

`daynight review list` 与 `daynight review ls` 是等价命令，按当前配置的顺序分组打印
仓库，并按 PR 编号排序，列出本地最近完整观测中仍为 Open 的已跟踪 PR，包括 Draft。
PR 已完成审查或审查最终失败，只要仍被观测为 Open，就继续显示；已关闭 PR 和已从
当前配置移除的仓库不显示。

每个仓库显示最近成功完整轮询的 `Last observed` 时间和已保存的轮询错误。初始化
完成后显示永久跟踪边界；编号不超过边界的 PR 未逐条保存，列表必须明确说明这些 PR
被排除且未跟踪，不能声称列出所有 GitHub Open PR。初始化完成但没有已跟踪的 Open
PR 时显示 `No tracked ongoing PRs.`；数据库不存在、仓库尚未登记或尚未完成初始化
时显示 `Not initialized.`。输出代表本地保存的快照，不保证反映此后的远程变化或
当前 daemon、agent 的存活状态。

表格包含 `PR`、`PR STATE`、`REVIEW` 和 `ATTEMPTS`。审查状态覆盖 `Preparing`、
`Running`、`Pending`、`Retry waiting`、`Completed`、`Failed`、`Interrupted`，
Draft 显示 `Paused`。下次重试时间和已保存错误归属到对应审查记录。PR 的最新待审
修订、head 和目标分支与旧审查独立：旧版本仍活跃时，最新版本显示待处理，并另行显示
旧版本的状态、尝试预算、重试时间和错误。不得把旧版本的尝试次数、失败或完成状态
归到新版本；仅目标分支的 base SHA 变化不会使完成状态失效。

命令读取当前配置和 SQLite 的一致快照，可与运行中的 daemon 并行执行。它不启动
监控、不执行 Git 或网络调用、不获取 review 实例锁、不创建缺失的数据库、不迁移
表结构、不恢复审查，也不修改应用状态。读取已有 WAL 数据库时，SQLite 自身可能
创建或更新协调使用的伴随文件。配置缺失或无效、已有数据库无法读取或损坏、表结构
版本不受支持时，必须显示错误并以非零状态退出。

## 验收场景

| 场景 | 必需结果 | 对应需求 |
|---|---|---|
| 在 Linux、macOS 或 Windows 上执行 `daynight --daemon-review`。 | 前台 CLI 通过直接启动 Copilot 子进程支持所需工作流程，并已验证命令执行、输出处理和正常退出。 | R1 |
| 从不同工作目录执行启动命令。 | 读取同一份 `~/.daynight/config.yml` YAML 配置，使用 `~/.daynight/` 中的同一份运行状态；仓库相对路径按配置目录解析。 | R1, R2, R13 |
| 配置不存在时执行 `daynight add-repo <remote>`。 | 自动创建 YAML，使用默认 `~/daynights` 根目录和规范化仓库身份生成绝对 `path`；只保存配置。 | R2 |
| 添加仓库后修改 `repositoryRoot`，再添加另一个仓库。 | 只有后添加仓库使用新的根目录；原条目的 `path` 保持原值。 | R2 |
| 从任意目录执行带相对 `--path` 的添加命令。 | 按命令当前目录解析并保存绝对路径，保留已有配置设置与注释。 | R2 |
| 重复添加同一仓库，或两个添加命令并发执行。 | 同仓库省略路径时复用已保存路径，显式同实际路径保持幂等，显式不同路径报错；并发写入不会丢失另一项修改，锁冲突明确失败。 | R2 |
| daemon 运行时添加仓库。 | 当前进程保留已有配置，下次启动后按正常启动流程克隆并初始化新增仓库。 | R2, R3, R4 |
| 执行 `daynight review list` 或 `daynight review ls`。 | 两者输出相同的本地一致快照，按配置仓库顺序及 PR 编号排列，包含 Draft 与仍然 Open 的已完成或失败审查。 | R15 |
| 已初始化仓库没有已跟踪的 Open PR，或仓库尚未初始化。 | 分别显示 `No tracked ongoing PRs.` 或 `Not initialized.`，并明确初始化边界以内的 PR 未逐条跟踪。 | R4, R15 |
| 较新 head 的待审修订等待旧版本审查结束。 | 最新版本显示待处理，旧版本的保存状态、尝试预算、重试时间及错误单独显示；仅 base tip 变化仍保留已完成状态。 | R6, R14, R15 |
| daemon 运行中或异常退出后读取列表。 | 不获取实例锁、不启动恢复、不执行 Git 或网络请求；`Running` 仅表示保存的状态，成功轮询时间和已保存错误显示数据时效。 | R13, R15 |
| 数据库不存在，或已有数据库损坏、为空文件或使用不支持的表结构版本。 | 缺失时只显示未初始化且不创建状态；已有无效数据库明确失败，不迁移或修复。 | R15 |
| 启动时，配置的本地仓库不存在。 | daemon 在使用该仓库进行审查前，将其 clone 到配置的路径。 | R2, R3 |
| 仓库初始化时发现已有 PR 的最大编号为 100，其中包括已关闭和 Draft PR。 | 保存的边界为 100。编号不超过 100 的 PR 永远不会被审查，包括后续发生变化的情况。 | R4 |
| daemon 在边界记录后重启。 | 复用已有边界，不会通过重新初始化将较新的 PR 排除。 | R4, R13 |
| 边界为 100，PR 101 出现时为 Open 且 ready。 | daemon 安排其首次审查。 | R5, R6 |
| PR 101 出现时为 Draft，之后收到新提交。 | 跟踪该 PR，但不启动审查；转为 ready 时需要审查。 | R5, R6 |
| 符合审查资格的 PR 出现新的 head SHA，或被 force push。 | 新版本需要审查。 | R6, R14 |
| 符合审查资格的 PR 修改目标分支。 | 目标分支变化需要审查。 | R6 |
| 只有目标分支收到新提交。 | 仅此变化不会安排审查。 | R6 |
| PR 在审查期间收到新提交。 | 同一 PR 不会同时运行第二个 agent；最新且符合审查资格的版本保持待处理状态。 | R7, R14 |
| 首次审查符合条件的 PR。 | daemon 在该仓库根目录的 `.worktrees/` 下创建此 PR 的独立 worktree。 | R9 |
| PR 需要再次审查，或需要从未完成的尝试中恢复。 | 只要 PR 仍然 Open，daemon 就恢复已有的 Copilot CLI 会话，并使用已有的 worktree。 | R8, R9, R12 |
| 审查发现 Critical 或 Major 问题。 | agent 发布 inline comments，不提交 `REQUEST_CHANGES`。 | R10 |
| 审查没有发现 Critical 或 Major 问题。 | agent approve 该 PR。 | R10 |
| 发布成功，且输出的最后一个非空行是 `PR 101 Review Completed`。 | daemon 识别出 PR 101 的该次尝试已经完成。 | R11, R14 |
| agent 退出时缺少严格匹配的最终标记。 | daemon 不记录协议完成状态，并恢复同一个会话进行确认或重试。 | R11, R12 |
| 进程结束时缺少标记，但发布可能已经成功。 | 恢复的 agent 在重试前核对先前在 GitHub 上产生的效果，避免明知结果已经发布却重复发布。 | R12 |
| 已审查的 PR 被合并，或未合并就被关闭。 | daemon 清理该 PR 的 worktree。 | R9 |
| daemon 重启时存在待处理或被中断的审查工作。 | 保存的边界、PR 版本、会话、worktree 和执行状态支持恢复，且不会错误地宣告完成。 | R13, R14 |

## 策略归属

上述需求不规定轮询间隔、不同 PR 之间的并发、重试上限和退避、进程超时，也不规定
编号超过边界的 PR 在 worktree 被清理后重新打开时的行为。架构和运维文档必须明确所选
策略及其限制，但不能将这些策略表述为额外的产品需求。
