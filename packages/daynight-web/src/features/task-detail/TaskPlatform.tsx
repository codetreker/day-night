import { useId, useLayoutEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { executionPlatform } from '../../api/parse';
import type { ExecutionPlatform, TaskDetail } from '../../api/types';
import { useI18n } from '../../i18n/LocaleProvider';
import { taskReviewKey } from './freshness';
import type { TaskMutationState } from './TaskDetailSession';

export const TaskPlatformBadge = ({ requiredPlatform, compact = false }: {
  readonly requiredPlatform: ExecutionPlatform | null;
  readonly compact?: boolean;
}) => {
  const { messages: { platform: m } } = useI18n();
  const label = requiredPlatform === null ? m.any : m.names[requiredPlatform];
  return <span className={`task-platform${compact ? ' task-platform-compact' : ''}`} title={`${m.title}: ${label}`}>{label}</span>;
};

const PlatformError = ({ error }: { readonly error: unknown }) => {
  const { messages: { platform: m, common } } = useI18n();
  const message = error instanceof ApiError
    ? error.kind === 'network' ? m.networkError : error.kind === 'protocol' ? m.protocolError
      : error.code === 'version_conflict' ? m.versionConflict : error.code === 'invalid_transition' ? m.invalidTransition
        : error.code === 'not_found' ? m.notFound : m.refused
    : m.requestFailed;
  return <><p>{message}</p>{error instanceof ApiError && error.requestId !== null && <p className="request-id">{common.requestId}{' '}<code>{error.requestId}</code></p>}</>;
};

export const TaskPlatformFeedback = ({ mutation, onReconcile }: {
  readonly mutation: TaskMutationState;
  readonly onReconcile: () => void;
}) => {
  const { messages: { platform: m } } = useI18n();
  if (mutation.operation?.action !== 'requiredPlatform') return null;
  const busy = mutation.phase === 'pending' || mutation.reconciling;
  const unresolved = mutation.phase === 'unknown' || mutation.reconciliationError !== null;
  const summary = mutation.reconciling ? m.checking : mutation.phase === 'pending' ? m.pending
    : mutation.phase === 'confirmed' ? m.confirmed : mutation.phase === 'unknown' ? m.unknown
      : mutation.phase === 'conflict' ? m.conflict : mutation.phase === 'reconciled' ? m.reconciled : null;
  return <div className="task-platform-feedback" aria-live="polite" aria-busy={busy}>
    {summary !== null && <p role={unresolved || mutation.phase === 'conflict' ? 'alert' : 'status'}>{summary}</p>}
    {unresolved && <button className="button" type="button" disabled={busy} onClick={onReconcile}>{mutation.reconciling ? m.checking : m.checkState}</button>}
    {mutation.error !== null && <div className="task-platform-error" role="alert"><PlatformError error={mutation.error} /></div>}
    {mutation.reconciliationError !== null && <div className="task-platform-error" role="alert"><p>{m.checkFailed}</p><PlatformError error={mutation.reconciliationError} /></div>}
  </div>;
};

export const TaskPlatform = ({ detail, disabled, mutation, onSave, onReconcile }: {
  readonly detail: TaskDetail;
  readonly disabled: boolean;
  readonly mutation: TaskMutationState;
  readonly onSave: (requiredPlatform: ExecutionPlatform | null, version: bigint) => void;
  readonly onReconcile: () => void;
}) => {
  const { messages: { platform: m } } = useI18n();
  const headingId = useId();
  const helpId = useId();
  const reviewKey = taskReviewKey(detail);
  const [draft, setDraft] = useState({ reviewKey, value: detail.requiredPlatform });
  const current = draft.reviewKey === reviewKey;
  const selected = current ? draft.value : detail.requiredPlatform;
  useLayoutEffect(() => { if (!current) setDraft({ reviewKey, value: detail.requiredPlatform }); }, [current, reviewKey, detail.requiredPlatform]);
  return <section className="task-detail-section" aria-labelledby={headingId}>
    <h4 id={headingId}>{m.title}</h4>
    <div className="task-platform-controls">
      <select aria-labelledby={headingId} aria-describedby={helpId} value={selected === null ? '' : selected} disabled={disabled}
        onChange={(event) => setDraft({ reviewKey, value: event.currentTarget.value === '' ? null : executionPlatform(event.currentTarget.value) })}>
        <option value="">{m.any}</option>
        {(['windows', 'linux', 'macos'] as const).map((platform) => <option value={platform} key={platform}>{m.names[platform]}</option>)}
      </select>
      <button className="button primary" type="button" disabled={disabled || !current || selected === detail.requiredPlatform}
        onClick={() => { if (current) onSave(selected, detail.version); }}>{m.save}</button>
    </div>
    <p className="task-platform-help" id={helpId}>{detail.status === 'in_progress' ? m.locked : m.help}</p>
    <TaskPlatformFeedback mutation={mutation} onReconcile={onReconcile} />
  </section>;
};
