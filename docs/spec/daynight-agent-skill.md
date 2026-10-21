# Agent 项目任务管理 Skill 需求

状态：设计文档已审查，任务完成以交付验收及 PR 合并为准；产品实现尚未交付。
本文规定随 `@codetreker/daynight` npm 包发布的 `daynight` skill 及其安装命令；文中的命令和行为是交付要求。实现机制由
[设计文档](../design/daynight-agent-skill.md)拥有，已有 project/task 命令、项目关联、
版本与错误语义继续由[客户端需求](daynight-project-task.md)拥有。

该 skill 供 Codex、Copilot CLI、Claude Code 等 Agent 在开发期间主动使用 daynight
查询、组织和维护项目任务。安装使 Agent 获得使用说明；项目关联决定任务管理的目标。

## AS1. 发布与安装产物

产品提供一份公开的 `daynight` skill，完整正文和所引用的随附资料共同包含在
`@codetreker/daynight` npm 安装产物中。skill 使用标准 `SKILL.md`，以英文编写，能够在
Codex、Copilot CLI 和 Claude Code 中使用。三个 Agent 使用同一份内容，不维护不同的
任务管理规则。

每次安装复制当前 npm 包携带的完整 skill。安装后的文件独立存在，npm 包移动、升级
或卸载不应使已安装内容失效。安装和使用 skill 不得依赖源码仓库、仓库内部工作流
skill、未发布文档或 npm 包外的临时文件。

## AS2. 启用条件与项目定位

skill 的发现说明必须表达触发场景：在已关联 daynight 的项目中进行开发时，主动查询
并维护任务。Agent 在工作开始、上下文恢复和切换 worktree 后，通过实际 CLI 查询
确定项目及当前任务，不凭先前会话中的项目 ID、任务 ID 或状态判断目标。

项目定位遵守现有 project/task 客户端规则。新建或 linked worktree 尚无本地
`.daynight/project.yml` 时，仍应允许 CLI 根据当前仓库及服务发现既有 project，不能仅
因本地关联文件缺失而认定项目没有接入。发现无匹配、匹配歧义或读取失败时，Agent
必须保留实际原因并说明如何明确目标，不能自行选择、创建或关联另一个 project。

安装 skill 与配置服务、创建 project、关联 worktree 是独立操作。安装命令不得以服务
配置、服务可达性、origin 或 daynight 项目关联作为安装前提，也不得为安装而创建这些
配置或远端资源。

## AS3. 查询与工作上下文

skill 必须教会 Agent 使用已发布的 `daynight project` 和 `daynight task` 命令，以
CLI 返回的服务结果为任务事实来源。开始工作时查询进行中的任务和可开始的任务，
使用 `task graph` 理解依赖和阻塞，使用 `task show` 获取选定任务的完整描述、状态、
依赖及版本。图中的标题预览不能替代完整任务详情。

Agent 应利用 `--json` 获取适合读取和处理的完整查询结果，同时保持 ID、版本、状态及
描述的原始含义。不得直接编辑本地关联文件、调用未公开接口或以仓库内的临时计划
覆盖服务中的任务事实。`ready`、状态和阻塞的含义继承既有服务与客户端要求。

## AS4. 持久任务与开发闭环

skill 必须覆盖开始工作、组织工作、推进工作和结束工作的完整闭环：

- 在已有任务中寻找与已授权工作相符的目标，读取详情后再维护任务。
- 对需要持续追踪、可能跨会话或需要交接的工作建立清楚的任务。标题描述交付结果，
  描述保留范围、验收条件和必要上下文，依赖表达实际的先后约束。
- 随实际推进更新状态和描述，将影响后续接手的决定、阻塞及剩余工作写回任务。
- 结束工作时根据实际交付维护状态，保留未完成事项和必要依赖。开发任务必须等到
  对应 PR 已合并、交付验收已满足后才标记 `done`；通过 PR 交付的设计和文档任务
  同样遵守此规则。代码写完、PR 创建、review 通过或 CI 通过均不代表完成，PR 仍
  打开时保持 `in_progress`，在描述中记录 PR 和当前等待事项。
- 完成前查询平台确认对应 PR 确实已合并，保留 PR 与 merge commit 引用；一个任务
  涉及多个交付 PR 时，全部必要 PR 合并并满足验收后才可完成。再用实际读取版本
  更新任务；只有确认的 `done` 才能通过现有依赖机制解锁后继。
- 非开发且无需通过仓库 PR 交付的任务按自身明确的验收条件判断；任务状态
  和完成要求也不授予合并权限。缺少权限或检查未满足时保持 `in_progress` 并记录
  等待事项。

短时命令步骤和 Agent 自身的临时执行计划无需逐项转成持久任务。拆分应形成可独立
理解和验收的交付工作，避免仅按工具调用或一次会话的步骤创建任务。任务管理不能
扩大用户授权；查询到任务、任务处于 `ready` 或状态变为 `in_progress` 均不赋予额外的
实现、发布、合并或外部通信权限。

## AS5. 更新、竞争与失败

Agent 更新现有任务前必须读取完整详情，并将其实际读取的精确 `version` 传给
`task update --if-version <version>`。不得省略期望版本来依赖 CLI 临提交前自动读取，
也不得截断、四舍五入或用另一个读取结果的版本替代。依赖更新是完整集合替换，
skill 必须说明省略字段、空描述、替换依赖和清空依赖的现有语义。

版本冲突后重新读取任务，理解并发变更对工作意图的影响，再决定如何处理；不得
仅取得新版本便自动重放旧更新。服务拒绝、网络错误和未确认的写入结果必须如实
报告，不能将其改写为成功或重复发送可能已生效的写操作。

现有任务状态不提供所有权或独占领取能力。skill 不得将设置 `in_progress` 描述为
原子 claim、锁、租约或阻止其他 Agent 开始工作的保证。并发协调依赖已有任务事实
及明确沟通，不引入新的 server API、任务字段或状态。

## AS6. 交互安装流程

公开入口为：

```bash
daynight skill install
```

命令依次完成检测、Agent 多选、scope 单选和安装。按当前环境的原生命令查找规则检测
可用的 `codex`、`copilot`、`claude` launcher；查找包含 PATH，Windows 还包含当前目录
及 PATHEXT。检测不运行这些命令，不以用户目录或已有 skill 目录代替命令可用性判断。
选项名称分别显示 Codex、Copilot CLI、Claude Code。

仅展示检测到的 Agent，初始均不选中，用户至少选择一个才能进入下一步。没有检测到
Agent 时给出清楚的诊断并失败退出。scope 对所有已选 Agent 统一生效，提供 `User`
和 `Project` 两项，默认选择 `User`。

交互所需终端不可用时，在任何安装写入前失败，提示从交互终端重新运行命令。
本交付不提供非交互安装参数。用户在安装写入开始前取消任一步骤时，不得产生
文件、配置或远端变更，且不得报告安装成功。

`skill`、`skill install` 的帮助和参数错误继续遵守 CLI 的帮助与依赖隔离要求；查看
帮助不检测 Agent、不启动提示、不读取服务配置、不访问服务、不写文件。

## AS7. scope 与发现目录

安装目标由所选 Agent 和 scope 决定：

| Agent | User | Project |
|---|---|---|
| Codex | `~/.agents/skills/daynight/` | `<worktree>/.agents/skills/daynight/` |
| Copilot CLI | `~/.agents/skills/daynight/` | `<worktree>/.agents/skills/daynight/` |
| Claude Code | `~/.claude/skills/daynight/` | `<worktree>/.claude/skills/daynight/` |

`Project` 指调用目录所属的当前 Git worktree 根目录；从子目录运行安装至同一根目录，
linked worktree 安装至自身根目录。非 Git 目录、bare repository 或根目录读取失败
必须给出明确错误。该定位只依赖 Git worktree，不要求 origin、daynight 关联或服务
配置。`User` 安装可以在 Git 仓库之外执行。

Codex 和 Copilot CLI 共同使用受支持的 `.agents/skills/` 目录，安装到同一位置时只保留
一份副本。这些目录不承诺某个安装副本仅被所选 Agent 发现；Agent 选择表达安装兼容
目标，不表达发现隔离。Copilot CLI 还可能发现项目内独立的 `.claude/skills/` 副本，
多个发现入口也可能通过符号链接共享。安装结果须列明实际目标，使用说明不得承诺
多个 scope 或目录中的同名副本会合并生效。

同名副本的发现和优先级遵循宿主规则，尤其 Claude Code 的个人 skill 优先于项目
skill；选择 Project 不删除或更新 User 副本。支持路径与宿主行为以官方说明为准：
[Codex skills](https://developers.openai.com/codex/skills/)、
[Copilot CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)、
[Claude Code skills](https://code.claude.com/docs/en/skills)。

## AS8. 覆盖与文件所有权

安装和更新使用同一条命令。再次运行时完整替换目标 `daynight` skill 目录，安装后
成功目标的全部文件与当前包内 bundle 一致；旧版本多余文件及用户在该目录内的修改
一并移除。不检查修改、不合并、不备份，也不增加逐文件覆盖确认。

安装器仅拥有目标目录的 `daynight` 叶节点，不得删除或重建共享 skill 根目录及其中
其他 skill。目标叶节点为符号链接时，只替换该链接本身，保留其指向的对象；祖先
skill 根目录的符号链接可以沿用。多个 Agent 通过祖先目录别名指向同一个实际安装
位置时，只安装一次，并保留每个 Agent 的结果和目标信息。去重后的实际目标若存在
严格的祖先与后代关系，必须在任何安装写入前拒绝，列明冲突目标；不能让后安装的
目录覆盖删除已经报告成功的另一个安装。

## AS9. 执行结果与部分失败

完成全部交互选择后，按确定顺序逐个安装目标。每个成功结果必须标明 Agent、scope
和目标路径，且只能在完整 bundle 安装成功后报告。所有目标成功时整体成功退出。

任一目标失败时立即停止后续安装，整体以非零状态退出，并明确区分已成功、失败和
未执行的 Agent。保留已完成目标，不跨目标回滚。失败诊断须指明目标和实际原因，
不能声称失败目标仍保留旧内容、已完整更新或所有目标均未改变，除非该事实已确认。
多个 Agent 共用同一实际位置时，共享该位置的安装结果，同时保留逐 Agent 表达。

## AS10. 验收要求

验收覆盖发布产物、宿主发现、可观察安装行为和任务管理行为。设计文档中的实现
分解不得替代以下证据：

| 编号 | 必须观察到的结果 |
|---|---|
| AS.V1 | 从实际 npm pack 安装产物执行命令，完整 `SKILL.md` 及其随附资料均可复制；安装后移走包源仍可读取所有安装资料 |
| AS.V2 | PATH fixture 分别覆盖零个、一个和多个 Agent；只出现可用命令对应选项，检测不启动 Agent；多选初始为空且至少选择一项，随后 scope 单选默认 User |
| AS.V3 | 无交互终端时明确失败并给出终端指引；交互各阶段及 scope 提交后首次写入前取消均无文件变更，stage 期间取消清理本次 stage 和新建空目录；帮助及参数错误无提示、检测、配置读取或安装副作用 |
| AS.V4 | 三个 Agent 的 User/Project 路径均正确；Project 从根目录、子目录和 linked worktree 定位各自 worktree；无 origin 或服务配置仍能安装，非 Git 与 bare 的 Project 安装明确失败 |
| AS.V5 | 再次安装清除旧文件和本地修改，成功目标与完整 bundle 一致；其他 skill 及共享根目录保留；叶节点符号链接的原指向对象保持不变，祖先根目录符号链接正常安装 |
| AS.V6 | 多 Agent 共享实际目标时只安装一次且每个 Agent 都有结果；实际目标任一方向嵌套时在写入前拒绝；按顺序注入安装失败后，先前成功保留、后续未执行、整体非零，诊断准确表达部分结果 |
| AS.V7 | 在支持的 Codex、Copilot CLI、Claude Code 中，用未点名 Daynight、skill 或其路径的普通开发请求，验证宿主自动选择并加载当前 bundle；另验证可发现性，记录宿主版本和 scope，覆盖重叠目录与同名副本；显式调用成功不能替代自动触发证据 |
| AS.V8 | 在真实 daynight 服务与已关联项目中，Agent 使用打包 skill 完成查询、graph/show、持久任务创建和带精确版本的更新；开发任务及通过 PR 交付的设计/文档任务在 PR 打开时保持 in_progress，平台确认全部必要 PR 合并且验收满足后才 done；新 worktree 无关联文件时也能发现同一项目 |
| AS.V9 | 行为验证覆盖并发版本冲突、依赖替换、服务失败和写入未确认；Agent 不盲重放、不虚报完成，不将 `in_progress` 作为独占领取；代码写完、PR 创建、review/CI 通过但未合并时不完成开发任务或解锁后继，合并确认后才更新并解锁；未接入或歧义项目的处理保留授权边界 |
| AS.V10 | CLI 的 typecheck、test、build 和安装验收通过；Linux、macOS、Windows 分别提供 PATH 检测、Git worktree 定位、交互取消、复制覆盖及符号链接相关适用行为的原生验证 |

发布产物和安装验证证明命令及文件行为；Agent 与真实服务的行为验证证明 skill
能支持任务管理闭环。两类证据分别记录实际版本和条件，不相互替代。文档准备或审查通过
不表示任务已交付，也不表示上述实现验收已经通过。
