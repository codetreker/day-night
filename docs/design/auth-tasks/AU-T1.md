# 建立 UniAuth 身份与凭据模块

## 方案

按[架构](../daynight-auth.md)实现身份模块及其真实 HTTP handlers，但不装入现有
生产 mux。负责 `internal/core` 身份结构、`core/store` 身份迁移/查询、
`internal/service` 登录/会话/PAT、`internal/server` 对应协议代码和模块测试。
现有 loopback 与业务入口保持，避免提前出现部分认证的运行时。

使用已核实的 UniAuth Go SDK pseudo-version，保留模块校验和，不使用本机 replace。
实现浏览器绑定 pending 原子消费、一次身份领取、唯一外部身份 upsert、七天会话、
自有 PAT 管理和日志分类。秘密至少 32 随机字节，仅持久化摘要。主站 Cookie 和
Origin 校验、Bearer 优先/禁止回退、配置来源精确验证由 handler 测试覆盖。

会话与 PAT 只代表用户，角色留给每次项目授权。PAT 只能由主站会话创建，名称、
1–365 天有效期及一次显示符合要求。模块保留取消、网络与数据库错误链。
到期判断立即生效；有界清理使用请求事务，不增加后台调度。
估算 180–300 分钟。

## 验收标准

- AU1–AU4、AU12 与 AU-V1/AU-V2 的模块级行为通过；实际受控 UniAuth handler/provider
  与 SDK 领取验证身份，不用返回固定用户的认证替身证明生产登录正确。
- 真实 PostgreSQL 覆盖并发首次登录、同邮箱不同 ID、state 重放/过期/错浏览器、
  provider error、两次 callback、领取断连/取消和事务失败；至多一次调用领取。
- Cookie/session、PAT 到期/撤销、无效 Bearer 不回退、PAT 不能签发 PAT、Origin 拒绝
  与秘密单次返回通过真实 handler 测试；日志不含任何秘密或原始身份 payload。
- 普通数据库行、错误值和 null profile 语义正确；关闭释放已取得资源，无后台遗留。
- 模块能够通过受支持的显式 composition 接入；没有匿名/可信用户绕过接口，未提前
  改变现有主入口。SDK 可从正常模块源解析，完整服务 gate 和必要文档同步通过。
- 必要 PR 平台确认合并后完成；真实上游人工登录由整体验收单独留证。
