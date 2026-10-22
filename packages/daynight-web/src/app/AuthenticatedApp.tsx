import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { listMembers, logout, me } from "../api/auth";
import type { AuthProvider, CurrentUser, ProjectRole } from "../api/auth-types";
import { ApiError, invalidateAuthRequests, isAbortError, subscribeUnauthorized } from "../api/client";
import type { Project } from "../api/types";
import { AccountPage } from "../features/management/AccountPage";
import { MembersPanel } from "../features/management/MembersPanel";
import { CreateProjectDialog } from "../features/auth/CreateProjectDialog";
import { InvitationPage } from "../features/auth/InvitationPage";
import { LoginPage } from "../features/auth/LoginPage";
import { captureInvitation, clearInvitation } from "../features/auth/invitation";
import { ProjectPage } from "../features/projects/ProjectPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { canonicalId } from "../api/parse";
import { navigate } from "./router";
import "../styles/auth.css";

type AuthRoute = { readonly kind: "projects" | "account" | "invitations" | "notFound" } | { readonly kind: "project" | "members"; readonly projectId: string };
export const parseAuthRoute = (pathname: string): AuthRoute => {
  if (pathname === "/") return { kind: "projects" };
  if (pathname === "/account") return { kind: "account" };
  if (pathname === "/invitations") return { kind: "invitations" };
  const match = /^\/projects\/([^/]+)(\/members)?$/.exec(pathname);
  if (match === null) return { kind: "notFound" };
  let decoded: string;
  try { decoded = decodeURIComponent(match[1]!); } catch { return { kind: "notFound" }; }
  const projectId = canonicalId(decoded);
  return projectId === null ? { kind: "notFound" } : { kind: match[2] === undefined ? "project" : "members", projectId };
};

const followLink = (event: MouseEvent<HTMLAnchorElement>) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(event.currentTarget.pathname);
};
const accountLabel = (user: CurrentUser) => user.name ?? user.email ?? "当前账户";
const AccessUnavailable = () => <section className="state-box" role="alert"><h1>项目不存在或你没有访问权限</h1><p>如果你认为应该可以访问，请联系项目管理员获取邀请。</p><a className="button primary" href="/" onClick={followLink}>返回我的项目</a></section>;

const AuthorizedProject = ({ projectId, user, onOpenMembers }: { readonly projectId: string; readonly user: CurrentUser; readonly onOpenMembers: (project: Project) => void }) => {
  const [membership, setMembership] = useState<{ status: "loading" | "ready" | "error" | "unavailable"; role: ProjectRole | null }>({ status: "loading", role: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setMembership({ status: "loading", role: null });
    void listMembers(projectId, controller.signal).then((members) => {
      if (controller.signal.aborted) return;
      const current = members.find((member) => member.userId === user.id);
      setMembership(current === undefined ? { status: "unavailable", role: null } : { status: "ready", role: current.role });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !isAbortError(error)) setMembership({ status: error instanceof ApiError && error.status === 404 ? "unavailable" : "error", role: null });
    });
    return () => controller.abort();
  }, [projectId, user.id, attempt]);
  if (membership.status === "unavailable") return <AccessUnavailable />;
  return <>{membership.status === "error" && <div className="notice error" role="alert"><p>暂时无法读取项目权限。</p><button className="button" type="button" onClick={() => setAttempt((value) => value + 1)}>重试读取权限</button></div>}<ProjectPage projectId={projectId} renderActions={(project) => membership.status === "ready" ? <><span className={`badge ${membership.role}`}>{membership.role === "admin" ? "管理员" : "成员"}</span><a className="button" href={`/projects/${projectId}/members`} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenMembers(project); }}>项目成员</a></> : null} /></>;
};

const Workspace = ({ user, children, route, onSignOut, checking }: { readonly user: CurrentUser; readonly children: ReactNode; readonly route: AuthRoute; readonly onSignOut: () => void; readonly checking: boolean }) => {
  const content = useRef<HTMLElement>(null);
  const label = route.kind === "projects" ? "我的项目" : route.kind === "account" ? "账户设置" : route.kind === "members" ? "项目成员" : route.kind === "project" ? "项目任务" : "页面不存在";
  useLayoutEffect(() => { content.current?.focus(); }, [route.kind, "projectId" in route ? route.projectId : null]);
  useEffect(() => { document.title = `${label} · Daynight`; }, [label]);
  return <div className="shell auth-shell" aria-hidden={checking} inert={checking}><a className="skip-link" href="#main-content">跳到主要内容</a><aside className="sidebar" aria-label="工作空间导航"><a className="brand" href="/" onClick={followLink} aria-label="Daynight 项目首页"><span className="brand-mark" aria-hidden="true" />daynight</a><nav aria-label="主导航"><p className="nav-label">工作空间</p><a className="nav-button" href="/" onClick={followLink} aria-current={route.kind === "projects" || route.kind === "project" || route.kind === "members" ? "page" : undefined}>▦　我的项目</a><a className="nav-button account-nav" href="/account" onClick={followLink} aria-current={route.kind === "account" ? "page" : undefined}>◎　账户设置</a></nav><div className="sidebar-bottom">团队工作空间<small>任务与依赖，一处看清</small></div></aside><div className="workspace"><header className="topbar"><nav className="crumb" aria-label="面包屑"><a href="/" onClick={followLink}>工作空间</a><span aria-hidden="true">/</span><span className="crumb-current" aria-current="page">{label}</span></nav><div className="account-actions"><a className="account-button" href="/account" onClick={followLink} aria-label={`账户设置：${accountLabel(user)}`}><span className="avatar" aria-hidden="true">{accountLabel(user).slice(0, 1).toUpperCase()}</span><span className="account-name">{accountLabel(user)}</span></a><button className="inline-link" type="button" onClick={onSignOut}>退出登录</button></div></header><main className="content" id="main-content" ref={content} tabIndex={-1}>{children}</main></div></div>;
};

const RevalidationOverlay = ({ failed, onRetry }: { readonly failed: boolean; readonly onRetry: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const opener = document.activeElement;
    dialog.current!.showModal();
    return () => queueMicrotask(() => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); });
  }, []);
  return <dialog ref={dialog} className="auth-revalidation-overlay" aria-label="重新确认当前账户" onCancel={(event) => event.preventDefault()} onKeyDown={(event) => event.stopPropagation()}>
    {failed ? <div role="alert"><h1>暂时无法重新确认当前账户</h1><p>当前工作已保留。确认账户后可继续。</p><button className="button primary" type="button" onClick={onRetry}>重新确认账户</button></div> : <div role="status"><span className="spinner" aria-hidden="true" /><p>正在确认当前账户…</p></div>}
  </dialog>;
};

type Session = { readonly status: "loading" } | { readonly status: "error" } | { readonly status: "anonymous"; readonly notice?: string } | { readonly status: "authenticated"; readonly user: CurrentUser; readonly generation: number };
const assignLogin = (url: string) => window.location.assign(url);

export const AuthenticatedApp = ({ navigateToLogin = assignLogin }: { readonly navigateToLogin?: (url: string) => void }) => {
  const [invitation, setInvitation] = useState(captureInvitation);
  const [pathname, setPathname] = useState(window.location.pathname);
  const [invitationRevision, setInvitationRevision] = useState(0);
  const invitationLifetime = useRef(new AbortController());
  const [session, setSession] = useState<Session>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [revalidation, setRevalidation] = useState<"idle" | "loading" | "error">("idle");
  const revalidationRef = useRef(revalidation);
  revalidationRef.current = revalidation;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [creating, setCreating] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const [projectName, setProjectName] = useState("项目");
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const route = parseAuthRoute(pathname);
  const [loginError] = useState(() => {
    const parameters = new URLSearchParams(window.location.search);
    const failed = parameters.get("authError") === "login_failed";
    if (parameters.has("authError")) { parameters.delete("authError"); window.history.replaceState(window.history.state, "", window.location.pathname + (parameters.size === 0 ? "" : `?${parameters}`)); }
    return failed;
  });
  const clearSession = useCallback((notice?: string) => {
    invalidateAuthRequests(); ++generation.current; active.current?.abort(); active.current = null;
    setCreating(false); setProjectName("项目"); setRevalidation("idle"); setSession({ status: "anonymous", ...(notice === undefined ? {} : { notice }) });
  }, []);
  useEffect(() => subscribeUnauthorized(() => clearSession(sessionRef.current.status === "authenticated" ? "登录状态已过期。重新登录后可继续访问项目。" : undefined)), [clearSession]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); invalidateAuthRequests(); };
  }, []);
  useEffect(() => {
    const onNavigate = () => {
      if (window.location.pathname === "/invitations" && window.location.hash !== "") {
        const incoming = captureInvitation();
        invitationLifetime.current.abort();
        invitationLifetime.current = new AbortController();
        setInvitation(incoming); setInvitationRevision((value) => value + 1);
      }
      setPathname(window.location.pathname);
    };
    window.addEventListener("popstate", onNavigate);
    window.addEventListener("hashchange", onNavigate);
    return () => { window.removeEventListener("popstate", onNavigate); window.removeEventListener("hashchange", onNavigate); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    const current = ++generation.current;
    if (sessionRef.current.status === "authenticated") setRevalidation("loading");
    else setSession({ status: "loading" });
    void me(controller.signal).then((user) => {
      if (controller.signal.aborted || current !== generation.current) return;
      const previous = sessionRef.current;
      if (previous.status === "authenticated" && previous.user.id === user.id) {
        setSession({ ...previous, user });
      } else {
        invalidateAuthRequests(); setCreating(false); setProjectName("项目");
        setSession({ status: "authenticated", user, generation: current });
      }
      setRevalidation("idle");
    }).catch((error: unknown) => {
      if (controller.signal.aborted || current !== generation.current || isAbortError(error)) return;
      if (error instanceof ApiError && error.status === 401) clearSession(sessionRef.current.status === "authenticated" ? "登录状态已过期。重新登录后可继续访问项目。" : undefined);
      else if (sessionRef.current.status === "authenticated") setRevalidation("error");
      else setSession({ status: "error" });
    });
    return () => controller.abort();
  }, [attempt, clearSession]);
  const discardInvitation = useCallback(() => { invitationLifetime.current.abort(); setCleanupFailed(!clearInvitation()); setInvitation({ token: null, storageUnavailable: false }); }, []);
  const completeInvitation = useCallback((projectId: string) => { discardInvitation(); navigate(`/projects/${projectId}`); }, [discardInvitation]);
  const cancelInvitation = useCallback(() => { discardInvitation(); navigate("/"); }, [discardInvitation]);
  const unavailableInvitation = discardInvitation;
  useEffect(() => { if (route.kind !== "invitations" && invitation.token !== null) discardInvitation(); }, [route.kind, invitation.token, discardInvitation]);
  const signOut = useCallback(() => {
    setLogoutFailed(false);
    const controller = new AbortController();
    const request = logout(controller.signal);
    clearSession("你已退出登录。");
    void request.catch((error: unknown) => {
      if (mounted.current && !isAbortError(error) && !(error instanceof ApiError && error.status === 401)) { setLogoutFailed(true); setSession({ status: "anonymous", notice: "本地账户数据已清除，但服务暂时无法确认退出。请重试退出登录。" }); }
    });
  }, [clearSession]);
  const recheckIdentity = useCallback(() => { revalidationRef.current = "loading"; setRevalidation("loading"); setAttempt((value) => value + 1); }, []);
  useLayoutEffect(() => {
    document.body.classList.toggle("auth-session-checking", revalidation !== "idle");
    return () => document.body.classList.remove("auth-session-checking");
  }, [revalidation]);
  useEffect(() => {
    if (session.status !== "authenticated") return;
    const refreshIdentity = () => { if (revalidationRef.current === "idle") recheckIdentity(); };
    window.addEventListener("focus", refreshIdentity);
    return () => window.removeEventListener("focus", refreshIdentity);
  }, [session.status, recheckIdentity]);
  const startLogin = (provider: AuthProvider) => {
    const returnPath = route.kind === "invitations" ? "/invitations" : pathname;
    const parameters = new URLSearchParams({ provider, returnPath });
    navigateToLogin(`/api/v1/auth/login?${parameters}`);
  };
  const cleanupWarning = cleanupFailed ? <div className="notice warning" role="alert">浏览器无法清除邀请临时数据。请关闭此标签页以清除邀请。</div> : null;
  if (session.status === "loading") return <main className="auth-main"><section className="state-box" role="status"><span className="spinner" aria-hidden="true" /><h1>正在确认登录状态</h1></section></main>;
  if (session.status === "error") return <main className="auth-main"><section className="state-box" role="alert"><h1>暂时无法确认登录状态</h1><p>请检查网络连接后重试。</p><button className="button primary" type="button" onClick={() => setAttempt((value) => value + 1)}>重试</button></section></main>;
  if (session.status === "anonymous") return <>{cleanupWarning}{route.kind === "invitations" && invitation.storageUnavailable && <div className="notice warning" role="alert">浏览器无法保存邀请。登录后请重新打开邀请链接。</div>}<LoginPage invitation={route.kind === "invitations"} {...(session.notice !== undefined ? { notice: session.notice } : loginError ? { notice: "登录未完成。身份服务暂时无法确认你的身份，请重新登录。" } : {})} onLogin={startLogin} />{logoutFailed && <button className="button" type="button" onClick={signOut}>重试退出登录</button>}</>;
  const identity = `${session.user.id}:${session.generation}`;
  const checking = revalidation !== "idle";
  const revalidationOverlay = checking ? <RevalidationOverlay failed={revalidation === "error"} onRetry={recheckIdentity} /> : null;
  if (route.kind === "invitations") return <>{revalidationOverlay}{cleanupWarning}<div aria-hidden={checking} inert={checking}><InvitationPage key={`${identity}:${invitationRevision}`} lifetime={invitationLifetime.current.signal} invitation={invitation} user={session.user} onComplete={completeInvitation} onCancel={cancelInvitation} onSwitchAccount={signOut} onUnavailable={unavailableInvitation} /></div></>;
  return <>{revalidationOverlay}<Workspace key={identity} user={session.user} route={route} onSignOut={signOut} checking={checking}>
    {cleanupWarning}{route.kind === "projects" ? <ProjectsPage onCreate={() => setCreating(true)} /> : route.kind === "project" ? <AuthorizedProject key={route.projectId} projectId={route.projectId} user={session.user} onOpenMembers={(project) => { setProjectName(project.name); navigate(`/projects/${project.id}/members`); }} /> : route.kind === "members" ? <MembersPanel key={route.projectId} projectId={route.projectId} projectName={projectName} user={session.user} onRemoved={() => navigate("/")} /> : route.kind === "account" ? <AccountPage user={session.user} onSignOut={signOut} /> : <section className="state-box"><h1>页面不存在</h1><a className="button primary" href="/" onClick={followLink}>返回我的项目</a></section>}
    {creating && <CreateProjectDialog onClose={() => setCreating(false)} onCreated={(project) => { setCreating(false); navigate(`/projects/${project.id}`); }} />}
  </Workspace></>;
};
