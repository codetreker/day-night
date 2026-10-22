# using-daynight Goal 工作流交付任务

本文拥有 Goal 的阶段顺序、真实任务身份、后续交付范围与完成条件。
[需求](../spec/daynight-goal-workflow.md)拥有 GW1–GW13，
[架构](daynight-goal-workflow.md)拥有机制，
[设计决策](../../.agents/notes/implemented/process/2026-10-22-goal-workflow-design.md)
拥有采用理由。当前运行状态、阻塞和 PR 以 Daynight 实际资源为准，本页不复制实时状态。

## 阶段顺序

| 阶段 | Daynight task ID | 前置 | 阶段完成的含义 |
|---|---|---|---|
| Goal description（`[Goal]为 using-daynight 引入分阶段 Goal 任务链`） | `03a3ee58-9d3a-4820-b582-8d4eb281a5ae` | 无 | 整体问题、范围、行为、排除项与验收已清楚；本工作无产品 UI，因此没有本次原型产出。描述完成只解锁设计。 |
| 架构设计与 task breakdown | `d2a31f2c-d77a-41ca-8170-3e0f0cc2504b` | Goal description | 完整设计、实际交付拆分、资料核验与独立审查完成，且所有必要设计 PR 平台确认合并。 |
| GW-T1：交付 using-daynight Goal 协议 | `81eb45ea-09c5-4708-b55b-8393abff2c15` | 架构设计与 task breakdown | 公开 bundle、相关 active 文档、全部合并前检查与独立指令审查完成，必要实施 PR 平台确认合并；只完成协议交付。 |
| GW-T2：验收 using-daynight Goal 工作流 | `d023f50f-4d5b-4137-92eb-a2cf0cbcc880` | GW-T1 | 准确已合并来源的打包与隔离安装、独立 bundle 情境审查及自身验收均通过；本任务确认完成后才报告整个 Goal 完成。 |

设计阶段必须完成全部后继实际登记，不能把拆分留到实施阶段。设计 PR 交接前核验
两个起始任务、GW-T1 和 GW-T2 的确定 ID、真实资料与依赖；GW-T1 通过 `dependsOn`
依赖设计，GW-T2 通过 `dependsOn` 依赖 GW-T1。执行前使用
`daynight task show <task-id> --json` 刷新实际状态与精确版本，再读取真实附件。

两个起始任务、GW-T1 与 GW-T2 均已登记。下表是设计交接时六份计划与设计附件的
所有权，不是通用配额；后续实际产出的专属资源与验收证据由所属任务增加。共享输入
引用来源，不向所有任务复制相同资料包。每个正文是自足简介，明确自己的具体问题、动作、范围、
交付物、约束、简明完成条件及来源引用；任务专属主附件拥有详细方案和完整验收。

| 资料所有者 | 本任务的附件 | 对外职责与共享输入 |
|---|---|---|
| Goal description：`03a3ee58-9d3a-4820-b582-8d4eb281a5ae` | `goal.md` | 整个 Goal 的要求与整体验收唯一来源；正文自身也说明整个目标、UI 不适用、排除项和简明整体验收。 |
| 架构与拆分：`d2a31f2c-d77a-41ca-8170-3e0f0cc2504b` | `architecture-plan.md`、`design.md`、`tasks.md` | 前者拥有本阶段详细方案与验收，后两者拥有架构与拆分产出；完整要求引用 Goal 任务的 `goal.md`。 |
| GW-T1：`81eb45ea-09c5-4708-b55b-8393abff2c15` | 专属 `plan.md` | 拥有协议交付详细方案与验收；引用 Goal 来源以及架构任务的 `design.md`、`tasks.md`。 |
| GW-T2：`d023f50f-4d5b-4137-92eb-a2cf0cbcc880` | 专属 `plan.md` | 拥有准确来源、安装产物与独立整体验收方案；引用 Goal、架构和 GW-T1 实际交付证据。 |

工作流规范 `docs/spec/daynight-goal-workflow.md` 与设计决策仍为仓库资料，任务引用其
已核验来源，不重复上传。共享任务输入以真实 task ID 与附件路径说明，并用实际
`daynight task attachment read <task-id> <path>` 读取；仓库远程引用须固定到已核验的
不可变提交 URL。不假设 `task://`、跨任务相对链接或固定主机存在。只有当前任务独立
需要快照时才复制，并记录来源、版本与目的。

设计 PR 交接前，专属主附件、设计产出和所有引用均须上传或确认已有来源后读回；
任务标题、本文表格或 ready 分页不能替代任务、附件内容与依赖的实际核验。

描述和设计交付分别完成问题定义及架构与拆分，不能代替协议实施或独立消费者验收。
设计 PR 未合并时，设计任务保持 in_progress，GW-T1 受其依赖阻塞；GW-T2 依赖 GW-T1。
创建后继任务不代表执行授权，也不授予设计或实施 PR 的合并权限。

## GW-T1：交付 using-daynight Goal 协议

### 单一目的与文件归属

GW-T1 负责让仓库发布的 `using-daynight` skill 按已采用设计表达完整 Goal 流程。
入口、阶段资料和各模式完成条件是同一个工作协议，连同有意义的验证在同一交付任务
中更新，避免把不一致的中间协议发布给使用者。所有必需合并前检查属于 GW-T1，不能
移交给后继验收后再补齐。

其正文必须具体说明修改 `SKILL.md`、新增 `references/goal.md`，同步创建、执行与
autopilot 指引以及普通任务和 Goal 阶段的自足简介、按需附件规则；交付相关 active
文档、包版本与已安装资源清单更新。正文同时概括必要合并前检查、独立指令审查和 PR
平台确认合并条件，引用本任务 `plan.md`、Goal 与设计实际来源。只写“交付 Goal 协议”
再附整套链接不能替代这段具体工作说明。

| 文件或位置 | 负责内容 |
|---|---|
| `packages/daynight/src/commands/skill/skills/using-daynight/SKILL.md` | 保留四模式路由与授权边界，持有共享 Goal 协议入口。 |
| 同目录 `references/goal.md` | 完整阶段协议，包括登记、阶段输入与输出、设计拆分、依赖、恢复及整体验收。 |
| 同目录 `references/create-task.md`、`run-task.md`、`autopilot.md` | 按职责引用协议，采用阶段资料门槛，保留登记返回、单任务返回和显式 autopilot。 |
| 同目录 `references/handbook.md` | 保留现有命令与数据语义；仅在新的跨文档引用实际需要时同步，不扩展 CLI。 |
| 根 `README.md`、`docs/spec/daynight-agent-skill.md`、`docs/design/daynight-agent-skill.md`、`docs/design/daynight.md`、`docs/spec/daynight-task-inspection.md` | 同步发布资源树、当前行为、资料归属及 Goal 入口，不将单任务规则误用于生产该资料的阶段。 |
| 本组 Goal 文档、相关 active 决策与安装验收 note | 同步实施状态、实际采用的协议和资源数量，保留历史理由；遵守 note 替代与相互链接规则。 |
| `packages/daynight/test/tooling/copy-skills.test.ts`、`test/cli/skill.acceptance.ts` 及相关检查 | 复用递归完整复制、安装树、frontmatter 和本地链接能力；将 `test/cli/e2e.acceptance.ts` 的已安装必需资源清单扩展为包含 `goal.md`，不为 prose 编写镜像断言。 |
| `packages/daynight/package.json` 及确需同步的包文件 | 按既有版本策略更新 CLI 包版本，版本高于实施 PR 当时的目标分支；不引入新依赖或运行时机制。 |

不涉及服务端、数据库、网页 UI、已安装 `.env` 副本、其他 skill、npm 发布或部署。
实施者遵守当前仓库指示，只在该任务共享 worktree 修改，保留无关变更；临时产物放入
任务 `.tmp/` 并清理所属探针与进程。共享文件由同一任务协调编辑，依赖只安装一次。

### 完成条件

- GW1–GW13 全部有一致的发布指引。普通单成果任务保持普通任务，多独立交付阶段使用
  任务链；描述与设计阶段以 brief 开始，完整结果是产出。
- Goal 创建同时登记两个初始任务，设计依赖描述；设计阶段实际登记完整后继拆分，
  实施根依赖设计。已有范围内许可覆盖登记，部分失败在真实 ID 上核对与恢复。
- UI Goal 在描述阶段产出最终样式、纯前端交互原型及资源；实施入口要求经交付的设计
  和适用原型。生产实现、架构决策与问题定义的职责不混淆。
- create-task、run-task、autopilot 的选择、返回、等待、权限与完成边界保持现有要求；
  描述 done、设计 done 和整个 Goal 完成能够分别判断。
- 普通任务和 Goal 各阶段正文都可独立理解，包含具体工作、产出、约束与简明可观察
  完成条件；详细方案和完整验收由各自主附件拥有。共享要求和设计按真实来源引用，
  附件按任务实际需要组织，计划资料及后续证据归属明确，无默认重复整包上传。
- 相关 active 文档和决策同一交付同步；发布入口 frontmatter、本地链接、英文、note
  结构和新增文件检查通过，`git diff --check` 无错误。
- 独立情境审查覆盖需求列出的场景，无未处理的 Critical/Major；较小或无关改进延后，
  不扩展当前目的。审查结果与文件/安装证据分别报告。
- 既有资源复制与链接套件、实际 build、npm pack 和隔离本地安装确认新共享协议完整
  发布，既有安装覆盖与 scope 语义有效；适用 typecheck、test、build 和 CI 真正通过。
- 必要实施 PR 经平台确认合并，主附件验收项记录必要证据与 merge commit 引用。
  读取实际版本并用 task complete 确认 done 后，将准确合并来源交接给 GW-T2；不宣称整个
  Goal 已完成。

## GW-T2：验收 using-daynight Goal 工作流

### 独立成果与输入

GW-T2 产出对准确已合并来源、实际安装 bundle 和完整原始目标的独立验收结论。输入是
已完成的 GW-T1、其必要 PR 的平台确认合并事实、merge commit、经交付的设计、完整
Goal 要求以及 GW-T1 的合并前验证证据。它不负责完成 GW-T1 缺少的 PR 门禁，也不以
GW-T1 的自检代替独立结果。

其正文必须说明核验准确已合并来源、记录包身份与 hash、实际 npm pack 和隔离安装、
比较完整路径与字节、执行模拟 launcher 六组合检查，以及独立审查安装 bundle 情境、
映射 GW1–GW13 到证据。正文同时说明不执行真实 Agent/模型、不发布部署或创建额外
真实任务，以及自身完成与整个 Goal 完成的先后；详细方法与证据归本任务 `plan.md`。

任务以准确的已合并源码在本任务共享 worktree 验证，不改变主 checkout 的既有工作。
临时打包、隔离安装、模拟 home、PATH、launcher 和证据位于任务 `.tmp/`；结束后清理
所属服务、进程及探针，必要证据以对应附件和交付记录保留。

### 验收范围与完成条件

- 先读取和确认 GW-T1 的真实 done、全部必要 PR 的合并结果及准确源码 commit。使用
  干净源码，记录平台、命令、包名称与版本、npm pack 产物及入口 hash；保留来源与
  产物之间的可追溯关系，不能把之前工作分支产物或另一来源的绿灯作为本次验收。
- 对实际 npm pack 产物在隔离目录安装，比较完整 bundle 的相对路径与每个文件字节，
  包括入口、四模式引用和共享 `goal.md`；核对所有引用、frontmatter 和随包资料可读。
  安装结果不依赖源码目录继续存在。
- 使用现有模拟 launcher 安装验收覆盖 Codex、Copilot CLI、Claude Code × User、Project
  六种组合，以及既有覆盖、迁移、资源保留与完整树检查。launcher 执行 sentinel 必须
  不存在；不执行真实 Agent 或模型，不读取账号。
- 独立读取实际已安装 bundle，情境审查普通单任务、多交付 Goal、两个起始任务、UI
  原型产出、已有链复用、空或部分登记恢复、精确版本、缺少许可与范围内许可、设计 PR
  等待、run-task 返回、无隐含 autopilot 和完整 Goal 完成。情境审查使用指令与既有
  证据，不创建额外真实任务、启动 autopilot 或改变其他链。
- 将 GW1–GW13 逐项映射到准确来源上的资料、验证结果与交付事实，保留未满足项和
  必要限制。明确区分指令审查、资源/文件检查与平台合并证据；不能声称文件证明模型
  一定遵循，也不能用模型执行替代安装器的确定性验证。
- 没有未处理的范围内 Critical/Major；确认缺陷时保留验收未完成状态，在现有授权内
  通过范围内修复 PR 处理。修复继续遵守完整检查、平台确认合并和合并权限；验收新的
  准确来源，不能擅自合并、发布 npm 或部署。
- 核验描述、设计、GW-T1 等其他任务已确认 done，必要 PR 已平台确认合并；本任务
  的原始 Goal 验收逐项满足。将独立证据与结论写入主附件对应验收项，必要修复交付
  保留 PR 与 merge commit；读取实际版本并用 task complete 确认 GW-T2 done 后，再核对
  全部任务和完整 Goal 验收，报告整个 Goal 完成。

设计整合后仅在相应授权内执行后继。任何阶段存在开放 PR、未通过检查或缺少合并许可
时保留当前任务与等待检查点；既有完成门槛不授予外部动作、发布、部署或合并权限。
