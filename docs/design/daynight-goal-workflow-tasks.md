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
| GW-T1：交付分阶段 Goal 流程 | `81eb45ea-09c5-4708-b55b-8393abff2c15` | 架构设计与 task breakdown | 公开 bundle、相关 active 文档和验证一致交付，必要实施 PR 平台确认合并，完整 Goal 验收满足。 |

两个起始任务和 GW-T1 已登记；GW-T1 通过 `dependsOn` 依赖设计任务。执行前使用
`daynight task show <task-id> --json` 刷新实际状态与精确版本，再读取真实附件。设计
任务有自己的阶段 brief；GW-T1 的 `plan.md` 与 `requirements.md` 提供实施方案和完整
Goal 要求，设计资料随设计交付核验。任务标题、本文表格或 ready 分页不能替代实时读取。

本次设计 PR 只交付规范、架构、任务拆分、决策及必要入口，不修改已发布 skill、测试或
包版本。设计 PR 保持可审阅时，设计任务继续 in_progress，GW-T1 继续依赖阻塞；创建
后继任务不代表执行授权，也不授予设计或实施 PR 的合并权限。

## GW-T1：交付分阶段 Goal 流程

### 单一目的与文件归属

GW-T1 负责让仓库发布的 `using-daynight` skill 按已采用设计表达完整 Goal 流程。
入口、阶段资料和各模式完成条件是同一个工作协议，连同有意义的验证在同一交付任务
中更新，避免把不一致的中间协议发布给使用者。

| 文件或位置 | 负责内容 |
|---|---|
| `packages/daynight/src/commands/skill/skills/using-daynight/SKILL.md` | 保留四模式路由与授权边界，增加共享 Goal 协议入口。 |
| 同目录 `references/goal.md` | 新增完整阶段协议，包括登记、阶段输入与输出、设计拆分、依赖、恢复及整体验收。 |
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
- 相关 active 文档和决策同一交付同步；发布入口 frontmatter、本地链接、英文、note
  结构和新增文件检查通过，`git diff --check` 无错误。
- 独立情境审查覆盖需求列出的场景，无未处理的 Critical/Major；较小或无关改进延后，
  不扩展当前目的。审查结果与文件/安装证据分别报告。
- 既有资源复制与链接套件、实际 build 和 npm pack 确认新共享协议完整发布，既有安装
  覆盖与 scope 语义有效；适用 typecheck、test、build 和 CI 真正通过。
- 必要实施 PR 经平台确认合并，主附件验收项记录必要证据与 merge commit 引用。
  刷新实际版本设置 done 并确认服务结果后，核对整个 Goal 的原始验收再报告目标完成。

不单独创建只做验收的任务：GW-T1 的成果就是可发布、资料一致且经过验证的协议。
设计整合后只能在相应授权内执行；开放 PR 或缺少合并许可时保留当前任务等待。
