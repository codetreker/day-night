import { useEffect, useRef, useState } from "react";
import { acceptInvitation, inspectInvitation } from "../../api/auth";
import type { CurrentUser, InvitationInspection } from "../../api/auth-types";
import { ApiError, isAbortError } from "../../api/client";
import type { PendingInvitation } from "./invitation";

type InspectionState = { readonly status: "loading" } | { readonly status: "error"; readonly error: unknown } | { readonly status: "ready"; readonly inspection: InvitationInspection };

export const InvitationPage = ({ invitation, lifetime, user, onComplete, onCancel, onSwitchAccount, onUnavailable }: {
  readonly invitation: PendingInvitation;
  readonly lifetime: AbortSignal;
  readonly user: CurrentUser;
  readonly onComplete: (projectId: string) => void;
  readonly onCancel: () => void;
  readonly onSwitchAccount: () => void;
  readonly onUnavailable: () => void;
}) => {
  const [state, setState] = useState<InspectionState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<unknown>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    if (invitation.token === null) { setState({ status: "error", error: null }); return; }
    const controller = new AbortController();
    const signal = AbortSignal.any([lifetime, controller.signal]);
    setState({ status: "loading" });
    const token = invitation.token;
    void Promise.resolve().then(() => inspectInvitation(token, signal)).then((inspection) => {
      if (!signal.aborted) setState({ status: "ready", inspection });
    }).catch((error: unknown) => {
      if (signal.aborted || isAbortError(error)) return;
      setState({ status: "error", error });
      if (error instanceof ApiError && (error.status === 410 || error.status === 404)) onUnavailable();
    });
    return () => controller.abort();
  }, [invitation.token, lifetime, user.id, attempt, onUnavailable]);
  useEffect(() => () => active.current?.abort(), []);
  const accept = () => {
    if (invitation.token === null || active.current !== null || state.status !== "ready") return;
    const controller = new AbortController(); active.current = controller;
    const signal = AbortSignal.any([lifetime, controller.signal]);
    setAccepting(true); setAcceptError(null);
    const token = invitation.token;
    void Promise.resolve().then(() => acceptInvitation(token, signal)).then((member) => {
      if (!signal.aborted) onComplete(member.projectId);
    }).catch((error: unknown) => {
      if (signal.aborted || isAbortError(error)) return;
      if (error instanceof ApiError && (error.status === 410 || error.status === 404)) { setState({ status: "error", error }); onUnavailable(); }
      else setAcceptError(error);
      setAccepting(false);
    }).finally(() => { if (active.current === controller) active.current = null; });
  };
  const unavailable = state.status === "error" && (state.error === null || state.error instanceof ApiError && (state.error.status === 410 || state.error.status === 404));
  return <div className="invite-page"><a className="brand" href="/" onClick={(event) => { event.preventDefault(); onCancel(); }} aria-label="Daynight 项目首页"><span className="brand-mark" aria-hidden="true" />daynight</a><main className="invite-card">
    {state.status === "loading" && <div role="status"><span className="spinner" aria-hidden="true" /><h1>正在读取项目邀请</h1></div>}
    {state.status === "error" && <><h1>{unavailable ? "邀请已不可用" : "邀请暂时无法加载"}</h1><p className="subtitle">{unavailable ? "此邀请可能已过期、被撤销或已使用。请联系项目管理员获取新的邀请。" : "请检查网络连接后重试。"}</p>{!unavailable && <button className="button primary" type="button" onClick={() => setAttempt((value) => value + 1)}>重试</button>}<div className="invite-footer"><button className="button" type="button" onClick={onCancel}>返回我的项目</button></div></>}
    {state.status === "ready" && <><h1>{state.inspection.member === undefined ? "你受邀加入一个项目" : "你已经是项目成员"}</h1><p className="subtitle">{state.inspection.member === undefined ? "确认项目信息后，加入并开始协作。" : "可以直接打开项目，无需再次接受邀请。"}</p><section className="invited-project"><h2>{state.inspection.projectName}</h2><p>加入角色：成员</p><ul className="permission-list"><li>读写项目中的任务与附件</li><li>查看项目成员</li></ul></section>
      <div className="invite-footer"><div className="invite-account"><div className="person"><span className="avatar" aria-hidden="true">{(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}</span><div><p className="person-name">{user.name ?? "当前账户"}</p><p className="person-meta">{user.email ?? "未提供邮箱"}</p></div></div><button className="inline-link" type="button" disabled={accepting} onClick={onSwitchAccount}>切换账户</button></div>
        {acceptError !== null && <div className="notice error" role="alert"><p>暂时无法接受邀请，请重试。</p></div>}
        <button className="button primary" type="button" disabled={accepting} onClick={state.inspection.member === undefined ? accept : () => onComplete(state.inspection.projectId)}>{accepting ? "正在加入…" : state.inspection.member === undefined ? "接受邀请并加入" : "打开项目"}</button><button className="inline-link" type="button" disabled={accepting} onClick={onCancel}>暂不加入</button>
      </div></>}
  </main></div>;
};
