import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createProject } from "../../api/auth";
import { ApiError, isAbortError } from "../../api/client";
import type { Project } from "../../api/types";
import { useI18n } from "../../i18n/LocaleProvider";
import { LanguageSelector } from "../../i18n/LanguageSelector";
import { useBodyScrollLock } from "../../app/useBodyScrollLock";

export const CreateProjectDialog = ({ onClose, onCreated }: { readonly onClose: () => void; readonly onCreated: (project: Project) => void }) => {
  const { messages: { auth: { createProject: m }, common } } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useBodyScrollLock(true);
  useLayoutEffect(() => {
    const opener = document.activeElement;
    dialog.current!.showModal();
    name.current?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  useEffect(() => () => active.current?.abort(), []);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (active.current !== null) return;
    const data = new FormData(event.currentTarget);
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(null);
    void Promise.resolve().then(() => createProject({ name: String(data.get("name")).trim(), repoUrl: String(data.get("repoUrl")).trim() }, controller.signal)).then((project) => {
      if (!controller.signal.aborted) onCreated(project);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && !isAbortError(cause)) { setError(cause); setBusy(false); }
    }).finally(() => { if (active.current === controller) active.current = null; });
  };
  return <dialog ref={dialog} className="auth-dialog" aria-labelledby="create-project-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}><header className="dialog-header"><h2 id="create-project-title">{m.title}</h2><LanguageSelector /><button className="close-button" type="button" aria-label={m.close} disabled={busy} onClick={onClose}>×</button></header><div className="dialog-body"><p>{m.intro}</p>
      <div className="field"><label htmlFor="project-name">{m.name} <span className="required">*</span></label><input ref={name} id="project-name" name="name" required autoComplete="off" disabled={busy} /></div>
      <div className="field"><label htmlFor="project-repository">{m.repository} <span className="required">*</span></label><input id="project-repository" name="repoUrl" required type="text" autoComplete="off" placeholder="https://github.com/team/project" disabled={busy} /><p className="hint">{m.repositoryHint}</p></div>
      {error !== null && <div className="notice error" role="alert"><p>{m.error}</p>{error instanceof ApiError && error.requestId !== null && <p>{common.requestId}<code>{error.requestId}</code></p>}</div>}
    </div><footer className="dialog-footer"><button className="button" type="button" disabled={busy} onClick={onClose}>{m.cancel}</button><button className="button primary" type="submit" disabled={busy}>{busy ? m.busy : m.submit}</button></footer></form>
  </dialog>;
};
