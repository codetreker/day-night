# 鉴权实现任务入口

状态：身份、成员、CLI 与 Web 已接入强制鉴权的正式 composition，统一启用源码及
验收调用方已更新；实际 gate、组合回执和任务完成状态由 Daynight 与对应 PR/CI
持有，本文不因代码接线而宣称验证全部通过。task show 读取完整任务，task attachment list 单独读取附件目录。
[需求](../spec/daynight-auth.md)拥有 AU1–AU12 和验收，[架构](daynight-auth.md)拥有
机制，[决策](../../.agents/notes/implemented/architecture/2026-10-22-auth-architecture.md)
拥有取舍。每个任务有一个方案/验收主附件，前端资料包含[原型](mockups/auth/index.html)
及全部相对资源；真实附件路径由确认上传后的任务描述引用。

## 交付目的与资料

| 编号 | 独立交付目的 | 主资料 | Daynight task |
|---|---|---|---|
| AU-D0 | 固定鉴权架构与执行资料 | [AU-D0.md](auth-tasks/AU-D0.md) | `7b5a71f5-27a8-412d-afc0-31430f613c77` |
| AU-T1 | 建立 UniAuth 身份与凭据模块 | [AU-T1.md](auth-tasks/AU-T1.md) | `7a5481ce-27f7-4a8c-91dd-14a5ea9656a7` |
| AU-T2 | 建立项目成员授权模块 | [AU-T2.md](auth-tasks/AU-T2.md) | `690db685-7261-4cc5-a570-fc2d52bb2de9` |
| AU-T3 | 为 CLI 配置服务访问凭据 | [AU-T3.md](auth-tasks/AU-T3.md) | `5b03e907-5a59-4013-ad30-341d17225a0d` |
| AU-T4 | 交付 Web 登录与项目协作界面 | [AU-T4.md](auth-tasks/AU-T4.md) | `e9a26625-0758-4e35-b047-44235e1b101c` |
| AU-T5 | 统一启用鉴权与项目权限 | [AU-T5.md](auth-tasks/AU-T5.md) | `ce2f8cd5-daab-40f2-8637-c1a8ae17e445` |
| AU-T6 | 验证完整多人鉴权链路 | [AU-T6.md](auth-tasks/AU-T6.md) | `35b9ba3d-97aa-41c7-ad5b-4bd4b08d5c2e` |

每项任务已上传 `proposal.md`。AU-D0、AU-T4、AU-T5、AU-T6 另有 `mockui/index.html`
及全部相对资源；登记时逐文件读回验证内容和元数据。

前置关系只保存在服务的 dependsOn，不在 Markdown 重复维护。按授权一次推进一项，
创建任务不启动实现或自动调度。设计任务只记录架构交付，不声称运行时功能完成。

## 文件归属与启用

身份/成员先独立验证的阶段保留在原任务与决策历史中。当前统一 composition 已接入
全部业务身份和成员检查、CLI 与双语 Web、必需配置、公开健康检查及正常 UniAuth
协议 fixture。启用任务拥有集成正反例和当前源码 gate；组合验收继续补充跨目标
回执，不能替代启用交付本身需要的证明。

附件保留可信同源 HTML、普通 iframe、相对资源和原键盘桥，复用主站 session；
该已采纳决策约束每个任务，不增加预览域名、凭据、bootstrap 或配套设施。
旧项目手工补成员；保留现有任务版本/图预算/单文件/K1，无旧数据兼容分支。

各主附件拥有文件范围、验收和分钟估算。同一任务共享唯一 worktree，manifest/锁文件/
composition/验收启动器由当前负责人编辑后交接，依赖只安装一次。前端附件保持最终
视觉和纯前端交互，桌面/窄屏/键盘/各数据状态有实际验证。

实现使用 Node.js 24 LTS、pnpm 11.28.6、Go 1.27.2、PostgreSQL 18.6，保留 README
的完整适用 gate、严格覆盖率、安装/补全、生产浏览器和资源预算。SDK/受控 provider
与真实上游人工联调分别留证，模拟测试不冒充端到端或原生平台证明。

任务验收及必要 PR 平台合并后方可完成；URL/title 在 properties.pullRequests，
merge commit 与对应验证放在主附件。未满足人工登录/环境/合并条件时保持未完成。
