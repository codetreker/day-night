# Daynight 需求

状态：产品范围已确认。已实现范围和可用命令见[仓库 README](../../README.md)。

Daynight 是一个在前台持续运行的 CLI，负责监控配置的 GitHub 仓库，并在符合条件的
PR 需要审查时启动 review agent。daemon 是这个 CLI 进程承担的角色。该进程维护仓库
副本、worktree、审查会话，以及持久化的调度状态。agent 审查代码，并自行将审查结果
发布到 GitHub。

本文档负责定义必需行为和验收场景。架构文档负责说明满足这些需求的机制。

## 需求

### R1. 包与运行方式

工具名为 `daynight`，应用代码放在 `packages/daynight/`，使用 TypeScript 编写。
工具在 Linux、macOS 和 Windows 上通过 `daynight --deamon-review` 以单个前台 CLI
启动，并持续运行直到被停止。CLI 负责轮询、维护 SQLite 状态、管理 worktree，并直接
将 Copilot 作为子进程启动。
三个平台必须支持相同的仓库、监控、会话、worktree、完成判定和恢复行为。必须在每个
平台上验证子进程调用、输出处理和正常退出。

### R2. 仓库配置

配置文件固定为 `~/.daynight/config.yml`，使用 YAML，通过远程地址和本地仓库路径
指定每个需要监控的 GitHub 仓库。`~` 表示当前操作系统用户的主目录，路径由程序解析；
从不同工作目录启动都读取同一份配置。仓库路径为相对路径时，相对于配置文件所在目录
解析。并发审查 Worker 数量的配置项名为 `maxConcurrentWorker`。每个配置的仓库
分别维护自己的初始化状态和 PR 状态。

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

## 验收场景

| 场景 | 必需结果 | 对应需求 |
|---|---|---|
| 在 Linux、macOS 或 Windows 上执行 `daynight --deamon-review`。 | 前台 CLI 通过直接启动 Copilot 子进程支持所需工作流程，并已验证命令执行、输出处理和正常退出。 | R1 |
| 从不同工作目录执行启动命令。 | 读取同一份 `~/.daynight/config.yml` YAML 配置，使用 `~/.daynight/` 中的同一份运行状态；仓库相对路径按配置目录解析。 | R1, R2, R13 |
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
