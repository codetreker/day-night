import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createToken, listTokens, revokeToken, type CurrentUser, type PersonalAccessToken } from '../../api/auth';
import { useI18n } from '../../i18n/LocaleProvider';
import { isAbortError } from '../../api/client';
import { ManagementDialog } from './ManagementDialog';
import { DateLabel, Identity, ManagementError, SecretDialog } from './feedback';

type TokenDialog = { readonly kind: 'create' } | { readonly kind: 'revoke'; readonly token: PersonalAccessToken } | { readonly kind: 'secret'; readonly secret: string };

type AccountPageProps = { readonly user: CurrentUser; readonly onSignOut: () => void };

export const AccountPage = (props: AccountPageProps) => <AccountContent key={props.user.id} {...props} />;

const AccountContent = ({ user, onSignOut }: AccountPageProps) => {
  const { messages: { auth: { management: { account: m, common } } } } = useI18n();
  const [tab, setTab] = useState<'profile' | 'tokens'>('profile');
  const [tokens, setTokens] = useState<readonly PersonalAccessToken[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<TokenDialog | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [days, setDays] = useState('30');
  const [validation, setValidation] = useState<'invalid' | null>(null);
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
      setValidation('invalid'); return;
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
    <div className="page-heading"><div><div className="eyebrow">{m.eyebrow}</div><h1 tabIndex={-1}>{m.title}</h1><p className="subtitle">{m.subtitle}</p></div></div>
    <div className="settings-grid"><nav className="settings-nav" aria-label={m.title}>
      <button type="button" className={tab === 'profile' ? 'active' : ''} aria-current={tab === 'profile' ? 'page' : undefined} onClick={() => setTab('profile')}>{m.profileTab}</button>
      <button type="button" className={tab === 'tokens' ? 'active' : ''} aria-current={tab === 'tokens' ? 'page' : undefined} onClick={() => setTab('tokens')}>{m.tokensTab}</button>
    </nav><div className="settings-main">
      {tab === 'profile' ? <><section className="panel"><div className="panel-body"><div className="profile-info"><Identity user={user} /></div><dl className="info-list"><dt>{m.loginMethod}</dt><dd>{m.viaUniAuth}</dd><dt>{m.profileSource}</dt><dd>{m.profileSourceDescription}</dd></dl></div></section><section className="panel"><div className="panel-heading"><div><h2>{m.sessionTitle}</h2><p>{m.sessionDescription}</p></div><button className="button" type="button" onClick={onSignOut}>{m.signOut}</button></div></section></>
        : <>
          {error !== null && <ManagementError error={error} retry={() => { void load(controller.current!.signal); }} />}
          <section className="panel" aria-labelledby="tokens-title"><div className="panel-heading"><div><h2 id="tokens-title">{m.tokensTitle}</h2><p>{m.tokensDescription}</p></div><button className="button primary" type="button" disabled={loading} onClick={() => open({ kind: 'create' })}>{m.createToken}</button></div>
            {loading && <div className="empty-inline" role="status">{m.loading}</div>}
            {!loading && tokens !== null && (tokens.length === 0 ? <div className="empty-inline">{m.empty}</div> : tokens.map((token) => {
              const expired = Date.parse(token.expiresAt) <= Date.now();
              return <div className={`row token-row${expired ? ' revoked' : ''}`} key={token.id}><div><div className="person-name">{token.name}</div><div className="person-meta">{common.createdAt} <DateLabel value={token.createdAt} /> {expired && <span className="badge warning">{common.expired}</span>}</div></div><div className="row-detail"><strong>{common.expiresAt} <DateLabel value={token.expiresAt} /></strong></div><div className="actions">{expired ? <span className="muted small">{common.unusable}</span> : <button className="button quiet" type="button" aria-label={m.revokeLabel({ name: token.name })} onClick={() => open({ kind: 'revoke', token })}>{common.revoke}</button>}</div></div>;
            }))}
          </section><div className="notice">{m.authorityNotice}</div><p className="muted small">{m.oneTimeNotice}</p>
        </>}
    </div></div>
    {dialog?.kind === 'secret' && <SecretDialog kind="token" secret={dialog.secret} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'create' && <ManagementDialog title={m.createTitle} busy={pending} onClose={() => setDialog(null)} footer={<><button className="button" type="button" disabled={pending} onClick={() => setDialog(null)}>{common.cancel}</button><button className="button primary" type="submit" form="create-token-form" disabled={pending}>{pending ? m.creating : m.createToken}</button></>}>
      <form id="create-token-form" onSubmit={(event) => { void create(event); }} noValidate><div className="field"><label htmlFor="token-name">{m.nameLabel} <span className="required">*</span></label><input id="token-name" value={name} onChange={(event) => setName(event.target.value)} required autoComplete="off" placeholder={m.namePlaceholder} /><p className="hint">{m.nameHint}</p></div><div className="field"><label htmlFor="token-days">{m.daysLabel}</label><input id="token-days" type="number" min={1} max={365} value={days} onChange={(event) => setDays(event.target.value)} required /><p className="hint">{m.daysHint}</p></div>{validation !== null && <p className="notice error" role="alert">{m.validation}</p>}{dialogError !== null && <ManagementError error={dialogError} />}<div className="notice">{m.createNotice}</div></form>
    </ManagementDialog>}
    {dialog?.kind === 'revoke' && <ManagementDialog title={m.revokeTitle} busy={pending} onClose={() => setDialog(null)} footer={<><button className="button" type="button" disabled={pending} onClick={() => setDialog(null)}>{common.cancel}</button><button className="button danger" type="button" disabled={pending} onClick={() => { void revoke(dialog.token); }}>{pending ? m.revoking : m.revokeConfirm}</button></>}><p>{m.revokeBody({ name: dialog.token.name })}</p>{dialogError !== null && <ManagementError error={dialogError} />}</ManagementDialog>}
  </>;
};
