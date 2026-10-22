import { useEffect, useRef, useState } from 'react';
import { createInvitation, listInvitations, listMembers, removeMember, revokeInvitation, setMemberRole, type CurrentUser, type ProjectInvitation, type ProjectMember } from '../../api/auth';
import { ApiError, isAbortError } from '../../api/client';
import { ManagementDialog } from './ManagementDialog';
import { DateLabel, Identity, identityName, ManagementError, SecretDialog } from './feedback';

type MemberDialog = { readonly kind: 'role'; readonly member: ProjectMember; readonly role: 'admin' | 'member' }
  | { readonly kind: 'remove'; readonly member: ProjectMember }
  | { readonly kind: 'invite' }
  | { readonly kind: 'revoke'; readonly invitation: ProjectInvitation }
  | { readonly kind: 'secret'; readonly secret: string };

type MembersPanelProps = {
  readonly projectId: string;
  readonly projectName: string;
  readonly user: CurrentUser;
  readonly onRemoved: () => void;
  readonly onUnavailable?: () => void;
  readonly onMembershipChange?: () => void;
};

export const MembersPanel = (props: MembersPanelProps) => <MembersContent key={`${props.user.id}:${props.projectId}`} {...props} />;

const MembersContent = ({ projectId, projectName, user, onRemoved, onUnavailable, onMembershipChange }: MembersPanelProps) => {
  const [members, setMembers] = useState<readonly ProjectMember[] | null>(null);
  const [invitations, setInvitations] = useState<readonly ProjectInvitation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<MemberDialog | null>(null);
  const [dialogError, setDialogError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const callbacks = useRef({ onUnavailable, onMembershipChange });
  callbacks.current = { onUnavailable, onMembershipChange };

  const load = async (signal: AbortSignal) => {
    const request = ++generation.current;
    setLoading(true); setError(null); setUnavailable(false);
    try {
      const result = await listMembers(projectId, signal);
      if (signal.aborted || request !== generation.current) return;
      const self = result.find((member) => member.userId === user.id);
      if (self === undefined) {
        setMembers(null); setInvitations(null); setUnavailable(true); callbacks.current.onUnavailable?.(); return;
      }
      setMembers(result);
      if (self.role === 'admin') {
        try {
          const invitations = await listInvitations(projectId, signal);
          if (!signal.aborted && request === generation.current) setInvitations(invitations);
        } catch (failure) {
          if (!(failure instanceof ApiError) || failure.status !== 403) throw failure;
          setMembers(null); setInvitations(null);
          const current = await listMembers(projectId, signal);
          if (signal.aborted || request !== generation.current) return;
          if (!current.some((member) => member.userId === user.id)) {
            setUnavailable(true); callbacks.current.onUnavailable?.();
          } else setMembers(current);
          callbacks.current.onMembershipChange?.();
          setNotice('项目权限已变化，已重新加载最新权限。');
        }
      } else setInvitations(null);
    } catch (failure) {
      if (!isAbortError(failure) && !signal.aborted && request === generation.current) {
        setError(failure);
        if (failure instanceof ApiError && (failure.status === 403 || failure.status === 404)) {
          setMembers(null); setInvitations(null);
          if (failure.status === 404) { setUnavailable(true); callbacks.current.onUnavailable?.(); }
        }
      }
    } finally { if (!signal.aborted && request === generation.current) setLoading(false); }
  };
  useEffect(() => {
    const active = new AbortController(); controller.current = active;
    setMembers(null); setInvitations(null); setDialog(null); setNotice(null);
    void load(active.signal);
    return () => active.abort();
  }, [projectId, user.id]);
  const self = members?.find((member) => member.userId === user.id);
  const admin = self?.role === 'admin';
  const adminCount = members?.filter((member) => member.role === 'admin').length;
  const open = (next: MemberDialog) => { setDialogError(null); setDialog(next); };

  const submit = async (action: Exclude<MemberDialog, { readonly kind: 'secret' }>) => {
    setPending(true); setDialogError(null); setNotice(null);
    const signal = controller.current!.signal;
    try {
      if (action.kind === 'role') {
        await setMemberRole(projectId, action.member.userId, { version: action.member.version, role: action.role }, signal);
        if (signal.aborted) return;
        if (action.member.userId === user.id && action.role === 'member') { setMembers(null); setInvitations(null); }
        callbacks.current.onMembershipChange?.();
      } else if (action.kind === 'remove') {
        await removeMember(projectId, action.member.userId, action.member.version, signal);
        if (signal.aborted) return;
        callbacks.current.onMembershipChange?.();
        if (action.member.userId === user.id) { setDialog(null); onRemoved(); return; }
      } else if (action.kind === 'invite') {
        const result = await createInvitation(projectId, signal);
        if (signal.aborted) return;
        const { link, ...metadata } = result;
        setInvitations((items) => [metadata, ...(items ?? [])]);
        setDialog({ kind: 'secret', secret: link }); return;
      } else await revokeInvitation(projectId, action.invitation.id, signal);
      if (signal.aborted) return;
      setDialog(null); await load(signal);
    } catch (failure) {
      if (!isAbortError(failure) && !signal.aborted) {
        if (failure instanceof ApiError && (failure.status === 403 || failure.status === 409 || failure.status === 404)) {
          setMembers(null); setInvitations(null); setDialog(null);
          setNotice(failure.status === 409 ? '成员状态已变化，已重新加载最新权限。请检查后再操作。' : '项目权限已变化，已重新检查你的访问权限。');
          callbacks.current.onMembershipChange?.();
          await load(signal);
        } else setDialogError(failure);
      }
    } finally { if (!signal.aborted) setPending(false); }
  };

  const dialogTitle = dialog?.kind === 'role' ? `变更 ${identityName(dialog.member)} 的角色？`
    : dialog?.kind === 'remove' ? `移除 ${identityName(dialog.member)}？`
      : dialog?.kind === 'revoke' ? '撤销邀请？' : '邀请项目成员';
  const confirm = dialog?.kind === 'role' ? '保存角色' : dialog?.kind === 'remove' ? '移除成员' : dialog?.kind === 'revoke' ? '撤销邀请' : '创建邀请链接';
  return <>
    <div className="page-heading"><div><div className="eyebrow">项目设置</div><h1 tabIndex={-1}>项目成员</h1><p className="subtitle">{projectName} · 管理协作成员与加入邀请</p></div>{admin && <button className="button primary" type="button" disabled={loading} onClick={() => open({ kind: 'invite' })}>邀请成员</button>}</div>
    {notice !== null && <div className="notice" role="status">{notice}</div>}
    {error !== null && <ManagementError error={error} retry={() => { void load(controller.current!.signal); }} />}
    {loading && <div className="empty-inline" role="status">正在加载项目成员…</div>}
    {unavailable && error === null && <div className="notice error" role="alert">项目不存在或你没有访问权限。</div>}
    {!loading && members !== null && <>
      {!admin && <div className="notice">你可以读写项目中的任务和附件。成员与邀请由项目管理员管理。</div>}
      <section className="panel" aria-labelledby="members-title"><div className="panel-heading"><div><h2 id="members-title">成员 <span className="badge">{members.length}</span></h2><p>所有成员都可以读写项目资源。</p></div></div>
        <div className="row head" aria-hidden="true"><span>成员</span><span>项目角色</span><span>操作</span></div>
        {members.map((member) => {
          const lastAdmin = member.role === 'admin' && adminCount === 1;
          return <div className="row" key={member.userId}><Identity user={member} self={member.userId === user.id} /><div>{admin ? <select className="role-select" aria-label={`${identityName(member)} 的项目角色`} aria-describedby={lastAdmin ? 'last-admin-note' : undefined} disabled={lastAdmin || pending} value={member.role} onChange={(event) => open({ kind: 'role', member, role: event.target.value as 'admin' | 'member' })}><option value="member">成员</option><option value="admin">管理员</option></select> : <span className={`badge${member.role === 'admin' ? ' admin' : ''}`}>{member.role === 'admin' ? '管理员' : '成员'}</span>}</div><div className="actions">{admin ? <button className="button quiet" type="button" aria-label={`移除 ${identityName(member)}`} disabled={lastAdmin || pending} title={lastAdmin ? '项目必须至少保留一名管理员' : undefined} onClick={() => open({ kind: 'remove', member })}>移除</button> : <span className="muted small">—</span>}</div></div>;
        })}
      </section><p className="muted small" id="last-admin-note">项目必须至少保留一名管理员。最后一名管理员需要先将另一位成员设为管理员，才能移除自己或变更自己的角色。</p>
      {admin && <section className="panel" aria-labelledby="invites-title"><div className="panel-heading"><div><h2 id="invites-title">有效邀请</h2><p>每个邀请链接只能使用一次，接受邀请后以成员身份加入。链接只在创建时显示。</p></div></div>
        {invitations !== null && (invitations.length === 0 ? <div className="empty-inline">还没有有效邀请。创建邀请链接，邀请团队成员加入。</div> : invitations.map((invitation) => <div className="row" key={invitation.id}><div><div className="person-name">邀请新成员</div><div className="person-meta">创建于 <DateLabel value={invitation.createdAt} /></div></div><div className="row-detail">到期 <DateLabel value={invitation.expiresAt} /></div><div className="actions"><button className="button quiet" type="button" aria-label={`撤销邀请 ${invitation.id}`} disabled={pending} onClick={() => open({ kind: 'revoke', invitation })}>撤销</button></div></div>))}
      </section>}
      <div className="role-legend"><div><h3>管理员</h3><p>读写项目、任务和附件，并管理项目成员及邀请。</p></div><div><h3>成员</h3><p>读写项目、任务和附件，与团队共同推进工作。</p></div></div>
    </>}
    {dialog?.kind === 'secret' && <SecretDialog kind="invitation" secret={dialog.secret} onClose={() => setDialog(null)} />}
    {dialog !== null && dialog.kind !== 'secret' && <ManagementDialog title={dialogTitle} busy={pending} onClose={() => setDialog(null)} footer={<><button className="button" type="button" disabled={pending} onClick={() => setDialog(null)}>取消</button><button className={`button${dialog.kind === 'remove' || dialog.kind === 'revoke' ? ' danger' : ' primary'}`} type="button" disabled={pending} onClick={() => { void submit(dialog); }}>{pending ? '正在提交…' : confirm}</button></>}>
      {dialog.kind === 'role' && <p>{dialog.role === 'admin' ? '管理员可以管理项目成员和邀请，并保留全部项目读写权限。' : '成员可以继续读写项目资源，成员和邀请由管理员管理。'}{dialog.member.userId === user.id && dialog.role === 'member' && '变更后，你将失去成员管理权限。'}</p>}
      {dialog.kind === 'remove' && <p>{dialog.member.userId === user.id ? '移除后，你将无法继续访问这个项目。重新加入需要管理员邀请。' : '移除后，对方的浏览器和访问令牌将无法继续访问这个项目。'}</p>}
      {dialog.kind === 'invite' && <><p>创建一个单次使用的邀请链接，分享给你希望加入项目的人。对方登录并确认后，以成员身份加入。</p><div className="notice">7 天后到期 · 单次使用 · 加入角色：成员</div></>}
      {dialog.kind === 'revoke' && <p>撤销后，这个邀请链接将立即失效。</p>}
      {dialogError !== null && <ManagementError error={dialogError} />}
    </ManagementDialog>}
  </>;
};
