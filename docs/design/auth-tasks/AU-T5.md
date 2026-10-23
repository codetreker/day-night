# 统一启用鉴权与项目权限

## 方案

按[鉴权架构](../daynight-auth.md)把身份、项目成员授权、CLI 和双语 Web 接入正式
入口。Go composition、配置、显式 Principal、全部资源 handler、Web 主入口、
localhost/dev-ci 和原有启动/验收调用方属于同一交付。视觉使用[原型](../mockups/auth/index.html)，
语言保持当前常驻 LocaleProvider、完整目录和选择器。TaskDetailSessionProvider
位于身份域内，跨关闭/重开保持同一任务的批准状态并在换账号时清除。估算
240–360 分钟。

server.New 接受 Dependencies、Config 和 logger，返回 handler 或 error；校验失败
关闭启动已取得的资源。全部业务入口强制认证，没有匿名或可信用户适配器。正式
main.tsx 在常驻 Provider 下挂载 AuthenticatedApp，保留当前任务/附件页签、渐进图、
浏览偏好与二语状态。现存零成员项目后续手工分配，不自动推断 owner。

### UniAuth 与运行配置

SDK 固定为 `github.com/codetreker/uniauth/sdk/go v0.0.0-20261022095215-0978963813fc`，
受控真实网关也固定[同一上游源码](https://github.com/codetreker/uniauth/tree/0978963813fcefd9d553f6cb9bcc319084c764b3)。
公开 GET /api/v1/auth/providers 通过 Providers(ctx, callbackURL) 取得当前 App
allowlist 与已启用 registry 的权威交集。空数组有效；上游配置、网络/协议及超时
分别映射 503、502 和 504，不能误报为用户会话 401。

五项必需配置为 DAYNIGHT_PUBLIC_ORIGIN、DAYNIGHT_UNIAUTH_URL、DAYNIGHT_UNIAUTH_APP_ID、
DAYNIGHT_UNIAUTH_APP_SECRET、DAYNIGHT_UNIAUTH_CALLBACK_URL。callback 精确同源、
query-free、canonical 非根路径，与 UniAuth 注册值一致；支持 `/auth/callback`，
只注册配置路径，不保留旧别名。启动拒绝路由冲突和编码别名，建立 pending 前拒绝
登录或实际 callback returnPath。秘密不下发浏览器或写入文档。

主站默认 HTTPS。DAYNIGHT_ALLOW_HTTP_TEST_ORIGIN=1 明确允许 HTTP 主站测试及
相应 Cookie；DAYNIGHT_ALLOW_LOOPBACK_HTTP=1 只控制 SDK gateway 的 literal
localhost/numeric-loopback HTTP 例外。两者独立，HTTPS 主站可使用显式回环 HTTP
gateway；命名主站测试域名不伪装为回环。主站地址与 callback 不从请求或随机
listener 推导。Go listener 保持 loopback；healthz/readyz 公开且无业务数据，就绪
只检查数据库。

### 业务与附件准入

每个 HTTP 请求读取当前凭据取得 Principal。资源读取在 Snapshot 内检查成员，
任务写入在项目锁内检查成员并执行领域约束；项目创建与首位 admin 原子提交，
列表在 SQL 分页前筛成员。任务 approve/claim/complete 同样显式传递 Principal，
在取得项目锁后检查成员；新任务默认 proposed，元数据 PATCH 不接受 status。
所有成员均可批准、领取和完成，管理员只额外管理成员/邀请；新 POST 与其 405
fallback 均经过 Require、Origin 与 no-store。凭据认证与业务事务各有准入时点，
不新增将凭据撤销和业务提交串行化的协议。

附件在短快照检查成员、项目、task 和路径后准入 IO，已准入操作允许完成，不在
文件 IO 后再次检查成员。可信同源 HTML、普通 iframe、相对资源、主站 session、
键盘桥、单文件操作及 K1 保持，不引入预览凭据、域名或网关。

### Fixture 与验证隐私

Go process、安装 CLI、Web native/container、Docker 附件恢复及预算 fixture 通过
正常 UniAuth 协议取得 session/PAT。只控制外部 provider 响应，目标独立拥有 App、
SQLite、端口与会话，不直接向 Daynight 数据库插入验收凭据或成员。

共享 preparer 固定源码，使用 CGO_ENABLED=0 的原生或架构匹配 Linux 产物；Node.js
24 内置 SQLite 准备锁串行保护跨进程源码/构建，缓存绑定目标、源码、工具链和产物。
私有 0600 元数据、CLI home、UA 数据和 auth.env 位于上传回执根之外。dev-ci 按
主站端口发现、真实 UA sidecar、私有配置、Go readyz 顺序启动；重建/恢复后按新
origin 精确 reconfigure，bootstrap 允许先恢复 SQL/文件，不增加第三个备份卷。

固定 Playwright 的 action/network trace 会捕获凭据 header 和响应体，因此普通
trace 与 capacity override 均关闭。秘密界面截图在关闭或遮蔽后捕获；PNG oracle、
自定义 CDP 性能 trace、全部断言/原始校验、容量与时间预算保持。证据与权衡由
[启用决策](../../../.agents/notes/implemented/architecture/2026-10-22-authentication-activation.md)拥有。

## 验收标准

- 同一源码完成全部适用 gate，检查不跳过；缺配置、匿名请求、Cookie 来源错误、
  非成员和错误身份按合同拒绝。
- 两名用户/部分共享项目证明列表分页、任务/图/属性/每种附件入口隔离；session/PAT/
  成员撤销、最后 admin 和邀请并发有启用组合证据。
- 真实 SDK discovery 覆盖 App allowlist、registry、空交集及配置/网络/协议/超时
  分类；生产 HTTPS、独立 HTTP 测试开关、精确 callback、冲突/循环拒绝有证明。
- 同一实际服务完成受控 UniAuth→session→Web 及安装 CLI PAT project/task/二进制
  附件流程，保持脚本/模块/相对资源/HEAD/下载和详情对话框键盘行为。
- Go build/vet/race/go-cov 与未舍入覆盖率 >90%、新增 fixture/准备锁 Node 检查、CLI
  原生安装/补全、Web 严格覆盖率/生产浏览器/容量、部署/配对恢复及预算门槛保留。
- 秘密不进入日志、回执、PNG 或普通 trace；清理只回收本 run 拥有的进程、profile、
  数据库、文件根、私有凭据及容器资源，失败保留原原因和可恢复身份。
- README、需求、设计和决策与当前实现一致。真实上游人工登录单独留证；缺少时
  不宣称全部完成。必要 PR 平台合并和实际验收满足后才完成任务。
