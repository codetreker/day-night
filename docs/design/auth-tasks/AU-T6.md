# 验证完整多人鉴权链路

## 方案

按[鉴权需求](../../spec/daynight-auth.md) AU-V1–AU-V10，在正式启用的真实服务上
验证 Go、Web、实际安装 CLI 与部署组合。任务补充跨目标和对抗组合证据，保留
[鉴权架构](../daynight-auth.md)的身份、成员与附件准入合同；视觉和交互遵守
[原型](../mockups/auth/index.html)。估算 120–240 分钟。

[AU-T5](AU-T5.md)统一启用正式入口、真实协议 fixture 与原有安全门禁。
其交付为 [PR #145](https://github.com/codetreker/daynight/pull/145)，合并 commit
`d07d5ec82aa5e5240d247651b5dc0bfe0e9eda7e` 的 tree
`352fd5f48058517b07e863774b2dbbc2e977dc8b` 与受测 PR head、CI synthetic merge
和合并前预期 tree 相同。[正式 CI run](https://github.com/codetreker/daynight/actions/runs/39820726467)
已经证明该源码的实际 SDK/UniAuth 协议、PG 竞争、同邮箱不同身份、安装 CLI PAT 与
基础二进制字节旅程、持久化/配对恢复和 51 项生产浏览器/容量验收。这些结果保留
各自源码范围；T6 新增代码后的完整门禁仍需新回执。

现有 inventory 为每目标 24 项功能，以及原生 5 项容量，共 53 项。T6 的原生和
容器组合旅程各提供一份额外必需回执，不替换或增加 Playwright 场景计数，不降低
原有数据规模、五次测量、请求/时间/内存预算、原始校验、零重试与清理要求。

## 实际领取后的网络中断

`packages/daynight-server/internal/server/auth_transport_acceptance_test.go`
使用固定真实 UniAuth 和正式 Daynight handler。只在 SDK 与网关之间放置窄代理：
真实 `/auth/result` 已消费结果并向代理返回有效 200 后，代理关闭实际下游 TCP
连接，使 SDK 未收到响应 header。验证真实网关再次领取为 410、callback 重放为
401，失败登录没有留下 pending、本地用户或 session，随后正常全新登录可恢复。
这项观测不能由 SDK mock 或合成读取错误替代。

新增测试已有一次 focused race 回执；该回执绑定基线 commit 与新增文件 SHA256
`20d5e75452021f75e879c850de8b8f9bcf1e4efe984afd7e85f4ee107555c6b7`，当时工作树
包含未提交测试，因此不能称为 clean head 或整个 T6 门禁通过。回执同时观察
product/proxy/gateway 清理、活动请求和劫持连接归零；完整当前源码验收另行留证。

## 两目标组合旅程

原生与容器分别使用正常协议登录的既有 Alice/Bob 两名用户，先记录原项目集合 A0/B0，
再建立共享项目 P 与 Bob 私有项目 Q。浏览器 session、正常签发 PAT 和实际安装 CLI
始终访问同一服务数据，
共同读写任务和附件；成员可读写资源与执行原有任务动作，admin 另可管理成员和
邀请。只控制外部 provider HTTP，不新增 persona、产品路由、可信身份适配器或
通用测试控制服务，不直接插入用户、凭据或成员。

每目标的组合回执必须直接观察：

- 正常邀请加入 P，浏览器与安装 CLI 看到相同任务和二进制附件；可信同源 HTML、
  脚本、模块、相对资源、HEAD、下载与详情对话框键盘保持可用。
- 仅重启该目标的 Daynight 服务后，原有 Cookie、PAT、成员、邀请及附件字节保持。
  重启回调由既有 runner 持有，保留数据库、文件根和 UniAuth 状态，不以新建凭据
  或重建项目掩盖持久化缺陷。
- 注销使原 session 失效但 PAT 仍可用；PAT 撤销后安装 CLI 得到 401，既有错误
  合同和无自动匿名重试/写重试保持。
- 真实 HTTP PUT 的前 64 KiB 已进入 staging，且附件索引仍未提交；此时移除成员，
  再发送剩余 body，已准入上传可返回 201。之后安装 CLI 与原始请求访问 P 为 404，
  私有 Q 仍为 200，证明新请求重新检查当前授权。
- 另一真实上传在 body 未结束时关闭 socket，等待其 staging 与索引清理完成。
  不将客户端主动取消的返回值当作服务端文件清理证据。
- PAT 先通过正常浏览器会话签发；仅对该令牌到期时刻施加测试控制，真实安装 CLI
  随后得到 401。测试不能直接构造凭据或用 session 到期代替 PAT 到期。
- 生产双语界面保留 pending 状态和一次性 PAT reveal；秘密关闭或遮蔽后才能截图。

组合机制由[组合验收决策](../../../.agents/notes/implemented/testing/2026-10-23-authentication-combined-acceptance.md)拥有；
两目标实际运行回执尚待验证，上述条目是完成条件。已准入文件 IO
允许完成，不在传输后复查成员，不将凭据撤销与业务提交串行化；保留 K1 的文件系统
与 PostgreSQL 非原子边界。整个应用仍使用主站同源可信 HTML，不增加预览凭据、
独立域名或网关。

## 回执、隐私与清理

沿用现有安装包及 runner 所有权：每份组合回执绑定源码、dirty 状态、安装包/入口
hash、原生进程或运行镜像、目标 origin、逐阶段观测和清理结果。原始文件字节由
安装 CLI 和浏览器共同验证；共享安装回执的来源与 hash 校验不能绕过。两份 schema 1
`kind: auth-combined` 回执分别位于该 run 的 `native/auth-combined/target.json` 与
`container/auth-combined/target.json`，严格检查十一项具名结果和浏览器/资源清理；
这两个目录纳入原有浏览器与命令恢复扫描。失败保留
安全的阶段、方法、路径、状态和 request ID，不输出原始凭据流量或错误 cause。

私有 0600 元数据、CLI home、App SQLite、auth.env 与会话材料位于上传回执根之外。
Cookie、Authorization、Set-Cookie、PAT、App Secret、code 和邀请秘密不进入回执、
日志、PNG 或持久 URL。普通 Playwright action/network trace 保持关闭；自定义
CDP、PNG oracle、全部原始校验、容量预算及断言保留。详细原因由
[统一启用决策](../../../.agents/notes/implemented/architecture/2026-10-22-authentication-activation.md)拥有。

清理只操作本 run 的进程、浏览器 profile、schema、文件根、私有凭据与容器资源。
body/socket 中断路径同样等待服务端结束和临时文件归零；清理失败必须使验收失败，
保留原始业务失败及可恢复的资源身份。

## 真实上游人工联调

使用实际 UniAuth App 和真实外部 provider 的人工登录、配置后隔离部署联调单独
留证。受控 provider、成功部署或 readyz 不能替代这一观察。所需 callback 注册、
人工登录或远程访问授权未满足时，该项保持待验收，不宣称 AU-V1 或整个任务完成；
不得由测试任务自行修改已有服务、反向代理、DNS 或 App 配置。

## 验收标准

- AU-V1–AU-V10 各自关联实际场景、源码/镜像、结果及清理证据；明确区分继承的
  T5 源码绑定结果、新增测试结果、两目标组合回执与真实上游人工联调。
- 实际领取后 TCP 断连、一次性重放、零 session 与全新登录恢复有真实网关/数据库
  观测；两目标组合旅程覆盖同数据、原凭据重启、撤销、已准入传输、socket 中断、
  PAT 到期和双语状态。
- 未认证、错误 Origin、非成员、错误身份和资源路径按原合同拒绝；不改变成员角色、
  任务生命周期、可信同源 HTML、K1 或新请求授权规则。
- 新增代码的同一版本完成全部适用 Go/CLI/Web/部署门禁与现有 53 场景/容量预算；
  失败先定位原因，未经证明的基础设施问题不重跑，历史结果不冒充当前源码结果。
- 全部秘密检查和任务资源清理通过；真实上游人工登录未取得时明确保留未满足项。
- 必要 PR 由平台确认合并，主附件保存 PR、merge commit 与验证定位后才完成任务。
