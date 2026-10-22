import { useEffect, useState } from "react";
import { getAuthConfig } from "../../api/auth";
import type { AuthProvider } from "../../api/auth-types";
import { isAbortError } from "../../api/client";

const providerLabels: Readonly<Record<AuthProvider, string>> = { microsoft: "Microsoft", google: "Google", github: "GitHub" };
const providerMarks: Readonly<Record<AuthProvider, string>> = { microsoft: "⊞", google: "G", github: "◉" };

export type LoginPageProps = {
  readonly invitation?: boolean;
  readonly notice?: string;
  readonly onLogin: (provider: AuthProvider) => void;
};

export const LoginPage = ({ invitation = false, notice, onLogin }: LoginPageProps) => {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; providers: readonly AuthProvider[] }>({ status: "loading", providers: [] });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<AuthProvider | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", providers: [] });
    void getAuthConfig(controller.signal).then((config) => {
      if (!controller.signal.aborted) setState({ status: "ready", providers: config.providers });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !isAbortError(error)) setState({ status: "error", providers: [] });
    });
    return () => controller.abort();
  }, [attempt]);
  return <div className="auth-page">
    <aside className="auth-aside"><a className="brand" href="/" aria-label="Daynight 项目首页"><span className="brand-mark" aria-hidden="true" />daynight</a>
      <div className="auth-copy"><h2>让任务有序推进，<br />让协作持续发生。</h2><p>在项目中整理任务、连接依赖、共享成果。与团队一起，把计划推进到完成。</p><div className="auth-visual" aria-hidden="true"><span>明确目标</span><span>连接工作</span><span>交付成果</span></div></div><p className="auth-caption">专注于你的项目，与团队共同前进。</p></aside>
    <main className="auth-main"><section className="auth-card"><p className="eyebrow">欢迎使用 DAYNIGHT</p><h1>登录你的工作空间</h1><p className="subtitle">{invitation ? "通过 UniAuth 登录后，继续确认项目邀请。" : "通过 UniAuth 登录，访问你的项目与任务。"}</p>
      {notice !== undefined && <div className="notice warning" role="status"><p>{notice}</p></div>}
      {state.status === "loading" && <p role="status"><span className="spinner" aria-hidden="true" />正在读取登录方式…</p>}
      {state.status === "error" && <div className="notice error" role="alert"><p>暂时无法读取登录方式，请重试。</p><button className="button" type="button" onClick={() => setAttempt((value) => value + 1)}>重试</button></div>}
      {state.status === "ready" && state.providers.length === 0 && <div className="notice error" role="alert"><p>当前没有可用的登录方式。请联系部署管理员。</p></div>}
      <div className="provider-list">{state.providers.map((provider) => <button key={provider} className="provider-button" type="button" disabled={selected !== null} onClick={() => { setSelected(provider); onLogin(provider); }}><span className="provider-icon" aria-hidden="true">{selected === provider ? <span className="spinner" /> : providerMarks[provider]}</span><span>{selected === provider ? "正在前往 UniAuth…" : `使用 ${providerLabels[provider]} 登录`}</span></button>)}</div>
      <p className="auth-note">登录后可以创建私有项目，或接受团队的项目邀请。<br />你的身份由 UniAuth 验证。</p>{selected !== null && <p className="invite-status" role="status">正在安全跳转，请稍候。</p>}
    </section></main>
  </div>;
};
