# 为 CLI 配置服务访问凭据

## 方案

按[架构](../daynight-auth.md)扩展现有 server 配置投影、setup 隐藏输入与 API client，
负责 `packages/daynight/src/config/`、`commands/setup/`、`commands/server/`、
`api/` 及对应帮助/补全、测试和公开 skill 的必要配置提示。

增加 serverToken，交互隐藏输入；明确的 `--server-token-stdin` 从 stdin 读取一行
秘密，互斥关系和错误先于 I/O 校验。凭据绑定 server origin，origin 变更原子清除
旧 token。配置使用既有锁和原子替换，秘密文件限制访问；项目绑定不保存凭据。

对原请求附加 Bearer；保留 manual redirects，拒绝跨 origin 转发凭据。
401 提示配置令牌，403/404/409 保留业务区别；不能重试写入、污染二进制 stdout
或偷偷添加登录预检请求。review/update/help/version 保留各自依赖边界。
估算 120–180 分钟。

## 验收标准

- AU4、AU9、AU11 对应 CLI 配置和真实受控 HTTP 行为通过；安装后的 CLI 可以对
  真实认证 handler 发送 PAT 并保留完整命令返回值。
- TTY 隐藏输入、stdin 的 EOF/多行/空值、取消、无 TTY、并发配置写入、Origin 变更
  和 symlink/权限错误按既有机制处理，真实 Bash/zsh/Windows 路径保留。
- 不在帮助、参数、日志、错误、仓库绑定或 stdout 暴露秘密；请求只携带到配置 origin，
  重定向不转发。401 不被当作空项目，也不自动匿名重试。
- project/task 版本、仓库发现、完整分页、请求/操作/累计响应预算以及单文件二进制
  put/read/remove 保持，既有命令参数错误优先级不变。
- typecheck/test/build、必要原生安装和真实 shell 补全通过；按包版本规则交付并同步
  文档，必要 PR 合并后完成。
