# 统一启用鉴权与项目权限

## 方案

按[架构](../daynight-auth.md)把已验证的身份、项目授权、CLI 和 Web 组件装入正式入口。
负责 Go composition/配置、业务 Principal 参数和全部 handler 接线、Web 主入口、
localhost/dev-ci 配置及既有启动/验收调用方。视觉使用[原型](../mockups/auth/index.html)。

启用后配置缺失拒绝启动，所有业务入口强制认证。Go 保持 loopback 和一个应用 origin，
健康检查改 readyz，保留 store 就绪。附件维持可信同源 HTML、普通 iframe、相对资源和
键盘桥，复用主站 session，不引入预览凭据/域名/网关或改变 K1。

项目列表 SQL 先筛成员；读取快照和写锁内授权；创建者 admin 原子提交；附件 IO 前
准入，已准入操作允许完成。全部入口同时接线，不留匿名或可信用户旁路。

同次适配 Go process/installed CLI、Web native/container、Docker 附件/恢复和预算
fixture。使用正常 UniAuth 协议取得 session/PAT；数值 loopback HTTP 配合明确 SDK
开发配置，固定候选端口/public origin/精确 callback，仅对已证明的 EADDRINUSE 重选
并更新本次 fixture 注册。复用现有进程和容器结构。估算 240–360 分钟。

## 验收标准

- 同一源码通过全部原有适用 gate，检查不跳过。缺配置、匿名请求、Cookie 来源错误、
  错误身份和非成员资源访问按合同拒绝。
- 两名用户/部分共享项目证明列表分页、任务/图/属性/每种附件入口隔离，session/PAT/
  成员撤销、最后 admin 和邀请并发，不能把首个集成安全证据延后。
- 同一真实服务完成浏览器 callback/session、安装 CLI PAT project/task/单文件二进制
  操作，同源 HTML/脚本/模块/相对资源/HEAD/下载及详情对话框键盘仍通过。
- 生产 HTTPS 配置与显式 numeric-loopback HTTP 开发配置分别验证；不从请求或随机
  listener 隐式推断生产地址。精确 callback、端口冲突和取消清理有证据。
- Go build/vet/race/go-cov、未舍入覆盖率 >90%、CLI 原生安装/补全、Web 严格覆盖率/
  生产浏览器/容量、部署/持久化/恢复保留；错误类别不被 internal_error 掩盖。
- README、需求、设计与运行命令同步为真实已交付状态，资源定向清理。可信同源预览
  已采纳决策保持，不增加独立域名、预览凭据或额外基础设施。必要 PR 合并后完成。
