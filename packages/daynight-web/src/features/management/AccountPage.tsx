import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createToken, listTokens, revokeToken, type CurrentUser, type PersonalAccessToken } from '../../api/auth';
import { isAbortError } from '../../api/client';
import { ManagementDialog } from './ManagementDialog';
import { DateLabel, Identity, ManagementError, SecretDialog } from './feedback';

type TokenDialog = { readonly kind: 'create' } | { readonly kind: 'revoke'; readonly token: PersonalAccessToken } | { readonly kind: 'secret'; readonly secret: string };

type AccountPageProps = { readonly user: CurrentUser; readonly onSignOut: () => void };

export const AccountPage = (props: AccountPageProps) => <AccountContent key={props.user.id} {...props} />;

const AccountContent = ({ user, onSignOut }: AccountPageProps) => {
  const [tab, setTab] = useState<'profile' | 'tokens'>('profile');
  const [tokens, setTokens] = useState<readonly PersonalAccessToken[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<TokenDialog | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [days, setDays] = useState('30');
  const [validation, setValidation] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const load = async (signal: AbortSignal) => {
    const request = ++generation.current;
    setLoading(true); setError(null);
    try {
      const result = await listTokens(signal);
      if (request === generation.current && !signal.aborted) setTokens(result);
    } catch (failure) {
      if (!isAbortError(failure) && !signal.aborted && request === generation.current) setError(failure);
    } finally {
      if (!signal.aborted && request === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    const active = new AbortController(); controller.current = active;
    if (tab === 'tokens') void load(active.signal);
    return () => { active.abort(); };
  }, [tab, user.id]);

  const open = (next: TokenDialog) => { setDialogError(null); setValidation(null); setDialog(next); };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const count = Array.from(name).length;
    if (name.trim() === '' || !name.isWellFormed() || name.includes('\0') || count > 100 || !/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 365) {
      setValidation('请输入 1–100 个字符的令牌名称，以及 1–365 天的有效期。'); return;
    }
    setPending(true); setDialogError(null); setValidation(null);
    const signal = controller.current!.signal;
    try {
      const result = await createToken({ name, days: Number(days) }, signal);
      if (signal.aborted) return;
      const { token, ...metadata } = result;
      setTokens((items) => [metadata, ...(items ?? [])]);
      setName(''); setDays('30'); setDialog({ kind: 'secret', secret: token });
    } catch (failure) { if (!isAbortError(failure) && !signal.aborted) setDialogError(failure); }
    finally { if (!signal.aborted) setPending(false); }
  };
  const revoke = async (token: PersonalAccessToken) => {
    setPending(true); setDialogError(null);
    const signal = controller.current!.signal;
    try {
      await revokeToken(token.id, signal);
      if (signal.aborted) return;
      setDialog(null); await load(signal);
    } catch (failure) { if (!isAbortError(failure) && !signal.aborted) setDialogError(failure); }
    finally { if (!signal.aborted) setPending(false); }
  };

  return <>
    <div className="page-heading"><div><div className="eyebrow">你的账户</div><h1 tabIndex={-1}>账户设置</h1><p className="subtitle">管理个人资料和 CLI、Agent 的访问凭据。</p></div></div>
    <div className="settings-grid"><nav className="settings-nav" aria-label="账户设置">
      <button type="button" className={tab === 'profile' ? 'active' : ''} aria-current={tab === 'profile' ? 'page' : undefined} onClick={() => setTab('profile')}>个人资料</button>
      <button type="button" className={tab === 'tokens' ? 'active' : ''} aria-current={tab === 'tokens' ? 'page' : undefined} onClick={() => setTab('tokens')}>访问令牌</button>
    </nav><div className="settings-main">
      {tab === 'profile' ? <><section className="panel"><div className="panel-body"><div className="profile-info"><Identity user={user} /></div><dl className="info-list"><dt>登录方式</dt><dd>通过 UniAuth</dd><dt>资料来源</dt><dd>姓名、邮箱和头像由登录身份提供。</dd></dl></div></section><section className="panel"><div className="panel-heading"><div><h2>当前会话</h2><p>退出当前浏览器的登录状态。</p></div><button className="button" type="button" onClick={onSignOut}>退出登录</button></div></section></>
        : <>
          {error !== null && <ManagementError error={error} retry={() => { void load(controller.current!.signal); }} />}
          <section className="panel" aria-labelledby="tokens-title"><div className="panel-heading"><div><h2 id="tokens-title">个人访问令牌</h2><p>让 CLI 和 Agent 以你的身份访问 Daynight。</p></div><button className="button primary" type="button" disabled={loading} onClick={() => open({ kind: 'create' })}>创建令牌</button></div>
            {loading && <div className="empty-inline" role="status">正在加载访问令牌…</div>}
            {!loading && tokens !== null && (tokens.length === 0 ? <div className="empty-inline">还没有访问令牌。创建后可用于 CLI 或 Agent。</div> : tokens.map((token) => {
              const expired = Date.parse(token.expiresAt) <= Date.now();
              return <div className={`row token-row${expired ? ' revoked' : ''}`} key={token.id}><div><div className="person-name">{token.name}</div><div className="person-meta">创建于 <DateLabel value={token.createdAt} /> {expired && <span className="badge warning">已过期</span>}</div></div><div className="row-detail"><strong>到期 <DateLabel value={token.expiresAt} /></strong></div><div className="actions">{expired ? <span className="muted small">不可使用</span> : <button className="button quiet" type="button" aria-label={`撤销令牌 ${token.name}`} onClick={() => open({ kind: 'revoke', token })}>撤销</button>}</div></div>;
            }))}
          </section><div className="notice">令牌代表你当前的项目权限。项目成员关系变化会立即影响后续访问；请只将令牌交给你信任的客户端。</div><p className="muted small">令牌明文只在创建成功时显示一次。丢失后请撤销并创建新令牌。</p>
        </>}
    </div></div>
    {dialog?.kind === 'secret' && <SecretDialog kind="token" secret={dialog.secret} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'create' && <ManagementDialog title="创建个人访问令牌" busy={pending} onClose={() => setDialog(null)} footer={<><button className="button" type="button" disabled={pending} onClick={() => setDialog(null)}>取消</button><button className="button primary" type="submit" form="create-token-form" disabled={pending}>{pending ? '正在创建…' : '创建令牌'}</button></>}>
      <form id="create-token-form" onSubmit={(event) => { void create(event); }} noValidate><div className="field"><label htmlFor="token-name">令牌名称 <span className="required">*</span></label><input id="token-name" value={name} onChange={(event) => setName(event.target.value)} required autoComplete="off" placeholder="例如：MacBook · 日常开发" /><p className="hint">用名称区分设备或自动化用途，最多 100 个字符。</p></div><div className="field"><label htmlFor="token-days">有效期</label><input id="token-days" type="number" min={1} max={365} value={days} onChange={(event) => setDays(event.target.value)} required /><p className="hint">按天设置有效期，范围为 1–365 天。</p></div>{validation !== null && <p className="notice error" role="alert">{validation}</p>}{dialogError !== null && <ManagementError error={dialogError} />}<div className="notice">令牌以你的身份访问项目。请勿将令牌放入代码仓库或公开日志。</div></form>
    </ManagementDialog>}
    {dialog?.kind === 'revoke' && <ManagementDialog title="撤销访问令牌？" busy={pending} onClose={() => setDialog(null)} footer={<><button className="button" type="button" disabled={pending} onClick={() => setDialog(null)}>取消</button><button className="button danger" type="button" disabled={pending} onClick={() => { void revoke(dialog.token); }}>{pending ? '正在撤销…' : '撤销令牌'}</button></>}><p>“{dialog.token.name}”将立即无法发起新的请求。使用它的 CLI 或 Agent 需要配置新的令牌。</p>{dialogError !== null && <ManagementError error={dialogError} />}</ManagementDialog>}
  </>;
};
