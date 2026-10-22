import { useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { ManagementDialog } from './ManagementDialog';

export const ManagementError = ({ error, retry }: { readonly error: unknown; readonly retry?: () => void }) => <div className="notice error" role="alert">
  <p>{error instanceof ApiError && error.status === 401 ? '登录状态已失效，请重新登录。'
    : error instanceof ApiError && error.status === 404 ? '项目不存在或你没有访问权限。'
      : '操作未能完成，请重试。'}</p>
  {error instanceof ApiError && error.requestId !== null && <p className="request-id">请求 ID：<code>{error.requestId}</code></p>}
  {retry && <button className="button" type="button" onClick={retry}>重试</button>}
</div>;

export const identityName = (user: { readonly name: string | null; readonly email: string | null; readonly userId?: string; readonly id?: string }): string =>
  user.name ?? user.email ?? user.userId ?? user.id!;

export const Identity = ({ user, self = false }: { readonly user: { readonly name: string | null; readonly email: string | null; readonly userId?: string; readonly id?: string }; readonly self?: boolean }) => <div className="person">
  <span className="avatar" aria-hidden="true">{Array.from(identityName(user)).slice(0, 2).join('').toUpperCase()}</span>
  <div><div className="person-name">{identityName(user)}{self && <span className="muted small">（你）</span>}</div>{user.email !== null && <div className="person-meta">{user.email}</div>}</div>
</div>;

export const DateLabel = ({ value }: { readonly value: string }) => <time dateTime={value}>{new Date(value).toLocaleString('zh-CN', { hour12: false })}</time>;

export const SecretDialog = ({ kind, secret, onClose }: { readonly kind: 'token' | 'invitation'; readonly secret: string; readonly onClose: () => void }) => {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [warning, setWarning] = useState(false);
  const value = useRef<HTMLTextAreaElement>(null);
  const invitation = kind === 'invitation';
  const close = () => setWarning(true);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      if (value.current === null) return;
      setCopied(true); setFailed(false);
    } catch {
      if (value.current === null) return;
      setCopied(false); setFailed(true);
      value.current.focus(); value.current.select();
    }
  };
  return <ManagementDialog title={invitation ? '邀请链接已创建' : '访问令牌已创建'} onClose={close} footer={<>
    {warning ? <><button className="button" type="button" onClick={() => setWarning(false)}>返回保存</button><button className="button primary" type="button" onClick={onClose}>确认已保存，关闭</button></>
      : <button className="button primary" type="button" onClick={onClose}>我已保存，关闭</button>}
  </>}>
    <p>{invitation ? '将链接分享给一位协作者。对方需要登录并确认加入。' : '把令牌保存在安全的位置，然后配置到 CLI 或 Agent。'}</p>
    <div className="credential"><textarea ref={value} aria-label={invitation ? '一次性邀请链接' : '一次性访问令牌'} readOnly value={secret} rows={3} /><button className="button" type="button" onClick={() => { void copy(); }}>{invitation ? '复制链接' : '复制'}</button></div>
    {copied && <p role="status">已复制。</p>}
    {failed && <p className="notice" role="status">浏览器未允许自动复制。已选中内容，请手动复制并保存在安全的位置。</p>}
    {invitation && <div className="notice">7 天后到期 · 单次使用 · 加入角色：成员</div>}
    <div className="one-time">{invitation ? '邀请链接' : '令牌明文'}只在创建时显示一次。关闭后无法再次查看；如果丢失，请撤销并重新创建。</div>
    {warning && <p className="notice error" role="alert">关闭后无法恢复这份{invitation ? '邀请链接' : '令牌'}。请确认你已保存。</p>}
  </ManagementDialog>;
};
