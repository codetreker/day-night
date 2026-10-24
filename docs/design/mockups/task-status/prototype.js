const $ = (id) => document.getElementById(id);
const statuses = ['todo', 'in_progress', 'done'];
const tabs = ['overview', 'attachments'];
const fixtures = ['normal', 'blocked', 'blocked-ordinary', 'successor', 'conflict', 'unknown', 'readback-failure', 'retained', 'loading', 'read-error', 'empty', 'empty-attachments', 'long'];
const copy = {
  zh: {
    prototype: '交互原型', prototypeNote: '仅模拟界面与状态，不连接服务', fixture: '场景', source: '初始状态', poll: '模拟任务更新', open: '打开详情', reset: '重置', detail: '任务详情', language: '语言', taskId: '任务 ID', copyId: '复制任务 ID', copy: '复制', copied: '已复制', copyFailed: '复制失败，请手动选择 ID 复制。', close: '关闭任务详情', target: '目标状态', set: '设置状态', automation: '自动执行', ready: '可以开始', blocked: '前置未完成', overview: '概览', attachments: '附件', description: '任务描述', dependencies: '前置任务', successors: '后继任务', version: '版本', start: '开始', complete: '完成', updated: '更新', unknown: '未知', files: '文件', upload: '上传文件', uploadHint: '原型保留上传入口，不提交文件。', newTab: '独立阅读 ↗', footer: '任务状态记录工作进度；不会授予执行、发布或合并权限。', same: '选择当前状态仍会校验版本，起止时间保持不变。', task: '交付统一的任务状态修改入口', longTask: '统一任务状态管理：让服务端、CLI、Web、精确版本、依赖保护与执行计时在长标题和窄屏中保持完整可读，并确保任务资料、附件阅读、自动执行许可和并发状态修改互不干扰。', pr: '统一任务状态修改入口', project: '项目', projectSubtitle: '让需求、任务与交付保持清晰。', total: '全部任务', active: '进行中', done: '已完成', backgroundHelp: '打开详情查看任务资料和状态。', cancel: '取消', confirm: '确认设置', closeConfirmation: '关闭确认', confirmTitle: '设置任务状态', question: '确认将这个任务设为所选状态？', noChange: '状态未改变。执行起止和更新时间保持不变。', timingStart: '开始一次新的执行计时，并清空完成时间。', timingReset: '清空本次执行的开始和完成时间。', timingFinish: '记录真实完成时间，并保留本次执行起点。', timingDirect: '仅记录真实完成时间；没有执行起点，因此耗时未知。', review: '按已审阅版本提交', noAuthority: '这次操作不会授予执行、发布或合并权限。', cancelPermission: '取消', confirmPermission: '确认修改', enableTitle: '允许自动执行', disableTitle: '关闭自动执行', permissionQuestion: '确认修改这个任务的自动执行许可？', permissionExplanation: '这项设置独立于任务状态。只有许可、依赖、平台和归属条件同时满足时，worker 才能领取。', pending: '正在设置状态…', pendingPermission: '正在保存自动执行许可…', busyHelp: '此任务的其他修改暂不可提交。关闭详情不会取消已经提交的修改。', changed: '任务状态已更新。', unchanged: '状态已经相同，状态和本次计时保持不变。', permissionChanged: '自动执行许可已更新。', dependencyError: '无法进入进行中或完成：仍有未完成的前置任务。普通依赖和外部依赖同样参与检查。', successorError: '无法退回这个已完成任务：后继任务仍在进行中或已完成。请先处理后继任务。', conflict: '任务版本已变化，修改没有按原版本完成。已读取最新任务，请重新审阅后决定。', uncertainty: '修改结果尚未确认。将只读取实际任务进行核对，不会自动重发修改。', readbackFailure: '核对失败，仍无法确认实际结果。状态和自动执行许可修改保持禁用。', check: '核对实际状态', checking: '正在读取实际任务…', reconciled: '已核对实际任务。下面显示服务器当前值；如需再次修改，请重新决定。', invalidated: '确认期间任务发生了变化。已关闭旧确认，请检查最新资料后重新决定。', loading: '正在读取任务…', readFailed: '无法读取任务详情', readHelp: '请重试读取；不会提交任何修改。', retry: '重试读取', retainedTitle: '刷新任务失败', retainedHelp: '保留上次读取的内容。完成最新读取前，状态和自动执行许可修改不可用。', notFound: '任务不可用', emptyHelp: '没有可读取的任务。关闭详情后可选择其他任务。', noFiles: '还没有附件。', permissionLocked: '执行中不能修改自动执行许可。', baseDependency: '架构与状态契约', externalDependency: '共享认证服务', successorTask: '验收真实跨端行为', ordinary: '普通依赖', external: '外部依赖', elapsed: '已运行 46 分钟', duration: '耗时 42 分钟', unknownDuration: '完成耗时未知', expected: '预期版本', latest: '当前版本', emptyPreview: '选择文件查看内容。', separateRead: '这是独立阅读演示；文件内容仍保留在原附件面板。', attachmentTitle: '统一任务状态修改', attachmentIntro: '通过专用状态操作统一三个任务状态，保持资料与依赖不变。', attachmentSolution: '方案', attachmentText: '复用项目写事务、精确版本和单任务写入会话。目标状态作为数据传递，修改失败时保留真实错误；结果未确认时先读取核对。', attachmentAcceptance: '验收条件', attachmentChecks: ['三种状态间的切换遵守依赖与精确版本检查。', '相同状态不改变版本、更新时间和计时。', '新一次执行替换起点；退回待处理状态清空本次计时。', '概览、附件和自动执行许可共享单任务写入控制。'], descriptionIntro: '以一个目标状态操作替换分散的生命周期动作，让任务可以重新打开、退回和直接完成。', descriptionHeading: '交付范围', descriptionItems: ['服务端专用状态接口及依赖保护', 'CLI 的 set-status 命令与补全', 'Web 状态选择、确认和结果核对', '随包工作流与真实跨端验收'], descriptionNote: '任务资料、依赖关系、PR 和附件不会因状态修改而丢失。', fixtureNames: ['正常任务', '外部前置未完成', '普通前置未完成', '存在执行中后继', '版本冲突', '响应丢失 · 核对成功', '响应丢失 · 核对失败', '保留内容 · 刷新失败', '首次读取中', '首次读取失败', '空结果 / 无任务', '附件为空', '长标题 / 长内容'], status: { todo: '待处理', in_progress: '进行中', done: '已完成' }
  },
  en: {
    prototype: 'Interactive prototype', prototypeNote: 'Simulated UI and state · no service connection', fixture: 'Scenario', source: 'Initial status', poll: 'Simulate task update', open: 'Open details', reset: 'Reset', detail: 'Task details', language: 'Language', taskId: 'Task ID', copyId: 'Copy task ID', copy: 'Copy', copied: 'Copied', copyFailed: 'Copy failed. Select and copy the ID manually.', close: 'Close task details', target: 'Target status', set: 'Set status', automation: 'Automatic execution', ready: 'Ready', blocked: 'Prerequisites unfinished', overview: 'Overview', attachments: 'Attachments', description: 'Description', dependencies: 'Prerequisites', successors: 'Successors', version: 'Version', start: 'Started', complete: 'Completed', updated: 'Updated', unknown: 'Unknown', files: 'Files', upload: 'Upload a file', uploadHint: 'The prototype retains this entry without uploading files.', newTab: 'Read separately ↗', footer: 'Task status records work progress. It grants no execution, publication, or merge permission.', same: 'Selecting the current status still checks the version and preserves execution timestamps.', task: 'Deliver one task status mutation', longTask: 'Unify task status management across the service, CLI, Web, exact versions, dependency protection and execution timing while keeping long task titles, narrow screens, attachments, automatic execution permission and concurrent writes fully readable and independent.', pr: 'Unify task status assignment', project: 'Projects', projectSubtitle: 'Keep requirements, tasks, and delivery clear.', total: 'All tasks', active: 'In progress', done: 'Done', backgroundHelp: 'Open details to read materials and set the status.', cancel: 'Cancel', confirm: 'Confirm status', closeConfirmation: 'Close confirmation', confirmTitle: 'Set task status', question: 'Set this task to the selected status?', noChange: 'The status is unchanged. Execution endpoints and the update time remain unchanged.', timingStart: 'Start a new execution interval and clear the completion time.', timingReset: 'Clear this execution attempt’s start and completion times.', timingFinish: 'Record the actual completion time and retain this execution start.', timingDirect: 'Record only the actual completion time. The execution start and duration remain unknown.', review: 'Submit the reviewed version', noAuthority: 'This operation grants no execution, publication, or merge permission.', cancelPermission: 'Cancel', confirmPermission: 'Confirm change', enableTitle: 'Allow automatic execution', disableTitle: 'Disable automatic execution', permissionQuestion: 'Change automatic execution permission for this task?', permissionExplanation: 'This setting is independent of task status. A worker still needs permission, ready prerequisites, a matching platform, and valid ownership.', pending: 'Setting task status…', pendingPermission: 'Saving automatic execution permission…', busyHelp: 'Other writes for this task are blocked. Closing details does not cancel a submitted write.', changed: 'Task status updated.', unchanged: 'The status already matches. Status and current execution timing are unchanged.', permissionChanged: 'Automatic execution permission updated.', dependencyError: 'Cannot start or complete this task while prerequisites are unfinished. Ordinary and external dependencies are checked equally.', successorError: 'Cannot reopen this completed task while a direct successor is in progress or done. Handle the successors first.', conflict: 'The task version changed, so the reviewed write did not complete at that version. The latest task was read; review it before deciding again.', uncertainty: 'The write outcome is unconfirmed. Read the actual task to reconcile it; the write is never retried automatically.', readbackFailure: 'The readback failed and the actual outcome is still unconfirmed. Status and automatic execution writes remain disabled.', check: 'Check actual task', checking: 'Reading the actual task…', reconciled: 'The actual task has been read. Current server values are shown; decide again before another write.', invalidated: 'The task changed during confirmation. The old confirmation was closed; review the current materials before deciding again.', loading: 'Reading task…', readFailed: 'Task details could not be read', readHelp: 'Retry the read. No write will be submitted.', retry: 'Retry read', retainedTitle: 'Task refresh failed', retainedHelp: 'The last content is retained. Status and automatic execution writes are unavailable until a fresh read succeeds.', notFound: 'Task unavailable', emptyHelp: 'There is no task to read. Close details to choose another task.', noFiles: 'There are no attachments yet.', permissionLocked: 'Automatic execution permission cannot change during execution.', baseDependency: 'Architecture and status contract', externalDependency: 'Shared authentication service', successorTask: 'Qualify the real cross-client journey', ordinary: 'Ordinary', external: 'External', elapsed: 'Running for 46 min', duration: 'Duration 42 min', unknownDuration: 'Completion duration unknown', expected: 'Expected version', latest: 'Current version', emptyPreview: 'Select a file to read its content.', separateRead: 'This is a separate-reading demonstration; the original attachment panel retains its content.', attachmentTitle: 'Unified task status assignment', attachmentIntro: 'Set any of the three task states through one dedicated operation while retaining materials and dependency edges.', attachmentSolution: 'Solution', attachmentText: 'Reuse project write transactions, exact versions, and the per-task mutation session. Pass the target status as data, preserve actual refusals, and read back an uncertain outcome before another decision.', attachmentAcceptance: 'Acceptance criteria', attachmentChecks: ['All three-state assignments obey dependencies and exact versions.', 'Same-state requests retain version, update time, and execution timing.', 'A new execution replaces the start; returning to todo clears the current attempt.', 'Overview, attachments, and automatic execution permission share one write controller.'], descriptionIntro: 'Replace separate lifecycle actions with one target-status operation, allowing tasks to reopen, return to pending, or complete directly.', descriptionHeading: 'Delivery scope', descriptionItems: ['Dedicated service status operation and dependency protection', 'CLI set-status command and completion', 'Web status selection, confirmation, and outcome reconciliation', 'Bundled workflow and real cross-client qualification'], descriptionNote: 'Status changes retain task materials, dependencies, PR references, and attachments.', fixtureNames: ['Normal task', 'External prerequisite unfinished', 'Ordinary prerequisite unfinished', 'Active direct successor', 'Version conflict', 'Lost response · readback succeeds', 'Lost response · readback fails', 'Retained content · refresh failure', 'Initial loading', 'Initial read failure', 'Empty / unavailable task', 'No attachments', 'Long title / long content'], status: { todo: 'To do', in_progress: 'In progress', done: 'Done' }
  }
};
let language = 'zh';
let scenario = 'normal';
let activeTab = 'overview';
let activeFile = 'plan.md';
let attachmentNotice = false;
let confirmation = null;
let priorFocus = null;
let detailOpen = true;
let readReady = true;
let readFailureCount = 0;
let task;
let phase = 'idle';
let feedbackKind = null;
let reconciliations = 0;
let operation = null;
let remoteTask = null;
let menuOpen = false;
let generation = 0;
let copyState = 'idle';
let copyGeneration = 0;
let toastVisible = false;
let toastTimer = null;
const events = [];
const m = () => copy[language];
const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const text = (id, value) => { $(id).textContent = value; };
const sourceState = () => $('source-status').value || 'todo';
const makeTask = (status) => {
  if (!statuses.includes(status)) throw new RangeError('Unknown task status.');
  return { status, version: 9007199254740993n, allowAgents: false, startedAt: status === 'in_progress' || status === 'done' ? '2026-10-24T09:00:00Z' : null, completedAt: status === 'done' ? '2026-10-24T09:42:00Z' : null, updatedAt: '2026-10-24T09:00:00Z', changedElsewhere: false };
};
const isBlocked = () => scenario === 'blocked' || scenario === 'blocked-ordinary';
const hasActiveSuccessor = () => scenario === 'successor';
const title = () => (scenario === 'long' ? m().longTask : m().task) + (task.changedElsewhere ? language === 'zh' ? ' · 已更新' : ' · Updated' : '');
const busy = () => phase === 'pending' || phase === 'unknown' || phase === 'checking' || phase === 'readback-failed';
const canWrite = () => readReady && !busy();
const statusBadge = (status) => `<span class="task-detail-status task-detail-status-${status}">${m().status[status]}</span>`;
const timingText = (source, target) => source === target ? m().noChange : target === 'in_progress' ? m().timingStart : target === 'todo' ? m().timingReset : source === 'in_progress' ? m().timingFinish : m().timingDirect;
const now = () => '2026-10-24T09:46:00Z';
const renderStatusOptions = (id, selected) => { $(id).innerHTML = statuses.map((s) => `<option value="${s}">${m().status[s]}</option>`).join(''); $(id).value = selected; };
const setTab = (tab) => {
  activeTab = tab;
  for (const name of tabs) {
    $(`${name}-tab`).setAttribute('aria-selected', String(tab === name));
    $(`${name}-tab`).tabIndex = tab === name ? 0 : -1;
    $(`${name}-panel`).hidden = tab !== name;
    $(`${name}-panel`).inert = tab !== name;
  }
};
const activateTab = (tab) => {
  setTab(tab);
  $(`${tab}-tab`).focus();
};
const navigateTabs = (event, tab) => {
  let next;
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  else if (event.key === 'Home') next = 'overview';
  else if (event.key === 'End') next = 'attachments';
  else return;
  event.preventDefault();
  activateTab(next);
};
const renderAttachmentFeedback = () => {
  $('attachment-feedback').hidden = !attachmentNotice;
  $('attachment-feedback').textContent = attachmentNotice ? m().separateRead : '';
};
const renderAttachment = () => {
  renderAttachmentFeedback();
  if (scenario === 'empty-attachments') {
    text('attachment-name', m().attachments);
    $('attachment-preview').innerHTML = `<p class="attachment-state">${escape(m().emptyPreview)}</p>`;
    return;
  }
  text('attachment-name', activeFile);
  document.querySelectorAll('[data-file]').forEach((button) => button.classList.toggle('attachment-file-selected', button.dataset.file === activeFile));
  $('attachment-preview').innerHTML = `<h1>${escape(activeFile === 'plan.md' ? m().attachmentTitle : language === 'zh' ? '状态契约与事务边界' : 'Status contract and transaction boundaries')}</h1><p>${escape(m().attachmentIntro)}</p><h2>${escape(m().attachmentSolution)}</h2><p>${escape(m().attachmentText)}</p><pre><code>task set-status &lt;task-id&gt; &lt;status&gt; --if-version 9007199254740993</code></pre><h2>${escape(m().attachmentAcceptance)}</h2><ul>${m().attachmentChecks.map((s) => `<li>${escape(s)}</li>`).join('')}</ul>${Array.from({ length: 5 }, () => `<p>${escape(m().descriptionNote)} ${escape(m().attachmentText)}</p>`).join('')}`;
};
const relation = (name, status, kind) => `<li><button type="button" class="task-detail-relation"><span class="task-detail-relation-dot task-detail-dot-${status}" aria-hidden="true"></span><span>${escape(name)}</span><span class="task-detail-relation-kind${kind === 'external' ? ' task-detail-relation-external' : ''}">${m()[kind]}</span><span class="task-detail-relation-arrow" aria-hidden="true">↗</span></button></li>`;
const renderFeedback = () => {
  const root = $('feedback');
  const kind = phase === 'unknown' ? 'uncertainty' : phase === 'readback-failed' ? 'readbackFailure' : phase === 'checking' ? 'checking' : feedbackKind;
  root.dataset.tone = kind === 'changed' || kind === 'unchanged' || kind === 'permissionChanged' || kind === 'reconciled' ? 'success' : kind === 'dependencyError' || kind === 'successorError' ? 'error' : 'warning';
  if (kind === null || kind === 'permissionChanged') { root.innerHTML = ''; return; }
  let content = `<p>${escape(m()[kind])}</p>`;
  if (phase === 'pending') content += `<p>${escape(m().busyHelp)}</p>`;
  if (kind === 'dependencyError') content += `<p><code>dependency_unsatisfied</code> · ${escape(scenario === 'blocked-ordinary' ? m().baseDependency : m().externalDependency)}</p>`;
  if (kind === 'successorError') content += `<p><code>dependency_unsatisfied</code> · ${escape(m().successorTask)}</p>`;
  if (kind === 'conflict') content += `<p><code>version_conflict</code></p>`;
  if (phase === 'unknown' || phase === 'readback-failed' || phase === 'checking') content += `<button class="button" id="reconcile" type="button"${phase === 'checking' ? ' disabled' : ''}>${escape(phase === 'checking' ? m().checking : m().check)}</button>`;
  root.innerHTML = content;
  $('reconcile')?.addEventListener('click', reconcile);
};
const render = () => {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  const t = m();
  const targets = { 'prototype-title': t.prototype, 'prototype-note': t.prototypeNote, 'fixture-label': t.fixture, 'source-label': t.source, 'poll-change': t.poll, 'open-detail': t.open, reset: t.reset, 'language-label': t.language, 'task-id-label': t.taskId, 'copy-task-id': t.copy, 'automation-label': t.automation, 'overview-tab': t.overview, 'attachments-tab': `${t.attachments} · 2`, 'description-label': t.description, 'pr-title': t.pr, 'dependencies-label': `${t.dependencies} · 2`, 'successors-label': `${t.successors} · 1`, 'started-label': t.start, 'completed-label': t.complete, 'updated-label': t.updated, 'files-label': `${t.files} · 2`, 'upload-label': t.upload, 'upload-hint': t.uploadHint, 'new-tab': t.newTab, 'detail-footer': t.footer, 'project-nav': t.project, 'project-subtitle': t.projectSubtitle, 'stat-total-label': t.total, 'stat-active-label': t.active, 'stat-done-label': t.done, 'background-task': t.task, 'background-help': t.backgroundHelp };
  for (const [id, value] of Object.entries(targets)) text(id, value);
  $('close-detail').setAttribute('aria-label', t.close);
  $('overview-tab').parentElement.setAttribute('aria-label', t.attachments);
  $('language').value = language;
  text('trigger-label', t.status[task.status]);
  $('trigger-dot').className = `task-detail-relation-dot task-detail-dot-${task.status}`;
  $('set-status').setAttribute('aria-label', `${t.set}, ${language === 'zh' ? '当前' : 'current'}: ${t.status[task.status]}`);
  $('status-menu').setAttribute('aria-label', t.set);
  renderStatusOptions('source-status', sourceState());
  $('fixture').innerHTML = fixtures.map((f, index) => `<option value="${f}">${escape(t.fixtureNames[index])}</option>`).join('');
  $('fixture').value = scenario;
  const hasDetail = !['loading', 'read-error', 'empty'].includes(scenario);
  text('task-title', hasDetail ? title() : scenario === 'loading' ? t.loading : scenario === 'read-error' ? t.readFailed : t.notFound);
  $('task-title').tabIndex = hasDetail ? 0 : -1;
  $('task-title').title = hasDetail ? title() : '';
  $('set-status').parentElement.hidden = !hasDetail;
  $('copy-task-id').setAttribute('aria-label', t.copyId);
  $('copy-task-id').disabled = copyState === 'pending';
  $('copy-feedback').hidden = copyState !== 'copied' && copyState !== 'failed';
  $('copy-feedback').textContent = copyState === 'copied' ? t.copied : copyState === 'failed' ? t.copyFailed : '';
  $('copy-feedback').className = `task-detail-copy-feedback${copyState === 'failed' ? ' task-detail-copy-error' : ''}`;
  $('copy-feedback').setAttribute('role', copyState === 'failed' ? 'alert' : 'status');
  $('permission-toast').hidden = !toastVisible;
  $('permission-toast').textContent = t.permissionChanged;
  $('status-badge').className = `task-detail-status task-detail-status-${task.status}`;
  text('status-badge', t.status[task.status]);
  $('ready-badge').hidden = task.status !== 'todo';
  $('ready-badge').className = isBlocked() ? 'task-detail-blocked' : 'task-detail-ready';
  text('ready-badge', isBlocked() ? t.blocked : t.ready);
  text('same-state-note', '');
  $('set-status').disabled = !canWrite();
  $('automation-switch').disabled = !canWrite() || task.status === 'in_progress';
  $('automation-switch').setAttribute('aria-checked', String(task.allowAgents));
  $('automation-switch').title = task.status === 'in_progress' ? t.permissionLocked : t.automation;
  let elapsed = '';
  if (task.status === 'done' && task.startedAt === null) elapsed = t.unknownDuration;
  if (task.startedAt !== null && (task.status === 'in_progress' || task.status === 'done')) {
    const end = task.status === 'done' ? task.completedAt : now();
    const minutes = Math.floor((Date.parse(end) - Date.parse(task.startedAt)) / 60000);
    const value = minutes < 1 ? language === 'zh' ? '不足 1 分钟' : '< 1 min' : `${minutes} ${language === 'zh' ? '分钟' : 'min'}`;
    elapsed = task.status === 'in_progress' ? `${language === 'zh' ? '已运行' : 'Running for'} ${value}` : `${language === 'zh' ? '耗时' : 'Duration'} ${value}`;
  }
  text('elapsed', elapsed);
  text('started', task.startedAt === null ? t.unknown : task.startedAt.replace('T', ' ').replace('Z', ' UTC'));
  text('completed', task.completedAt === null ? t.unknown : task.completedAt.replace('T', ' ').replace('Z', ' UTC'));
  text('updated', task.updatedAt.replace('T', ' ').replace('Z', ' UTC'));
  $('description').innerHTML = `<p>${escape(t.descriptionIntro)}</p><h3>${escape(t.descriptionHeading)}</h3><ul>${t.descriptionItems.map((s) => `<li>${escape(s)}</li>`).join('')}</ul><p>${escape(t.descriptionNote)}</p>${scenario === 'long' ? Array.from({ length: 8 }, () => `<p>${escape(t.attachmentText)}</p>`).join('') : ''}`;
  $('dependencies').innerHTML = relation(t.baseDependency, scenario === 'blocked-ordinary' ? 'todo' : 'done', 'ordinary') + relation(t.externalDependency, scenario === 'blocked' ? 'todo' : 'done', 'external');
  $('successors').innerHTML = relation(t.successorTask, hasActiveSuccessor() ? 'in_progress' : 'todo', 'ordinary');
  $('detail-backdrop').hidden = !detailOpen;
  $('project-background').inert = detailOpen;
  $('initial-state').hidden = !['loading', 'read-error', 'empty'].includes(scenario);
  $('initial-state').setAttribute('role', scenario === 'loading' ? 'status' : 'alert');
  if (scenario !== 'loading') { $('initial-state').removeAttribute('aria-label'); $('initial-state').setAttribute('aria-labelledby', 'task-title'); }
  else $('initial-state').removeAttribute('aria-labelledby');
  $('loaded-body').hidden = ['loading', 'read-error', 'empty'].includes(scenario);
  if (scenario === 'loading') { $('initial-state').setAttribute('aria-label', t.loading); $('initial-state').innerHTML = '<span class="spinner" aria-hidden="true"></span>'; }
  if (scenario === 'read-error') $('initial-state').innerHTML = `<p>${escape(t.readHelp)}</p><button class="button primary" type="button" id="initial-retry">${escape(t.retry)}</button>`;
  if (scenario === 'empty') $('initial-state').innerHTML = `<p>${escape(t.emptyHelp)}</p>`;
  $('initial-retry')?.addEventListener('click', () => loadScenario('normal', sourceState()));
  $('retained-error').hidden = scenario !== 'retained';
  if (scenario === 'retained') {
    $('retained-error').innerHTML = `<h3>${escape(t.retainedTitle)}</h3><p>${escape(t.retainedHelp)}</p><button type="button" class="button" id="retained-retry">${escape(t.retry)}</button>`;
    $('retained-retry').addEventListener('click', () => { scenario = 'normal'; readReady = true; render(); });
  }
  const emptyAttachments = scenario === 'empty-attachments';
  text('attachments-tab', `${t.attachments} · ${emptyAttachments ? 0 : 2}`);
  text('files-label', `${t.files} · ${emptyAttachments ? 0 : 2}`);
  $('attachment-files').hidden = emptyAttachments;
  $('new-tab').disabled = emptyAttachments;
  if (emptyAttachments && !$('no-files')) $('attachment-files').insertAdjacentHTML('afterend', '<p id="no-files" class="task-status-empty-files"></p>');
  if ($('no-files')) { $('no-files').hidden = !emptyAttachments; $('no-files').textContent = t.noFiles; }
  renderFeedback();
  renderAttachmentFeedback();
  setTab(activeTab);
};
const loadScenario = (next, source = sourceState()) => {
  cancelConfirmation(false);
  scenario = next;
  attachmentNotice = false;
  if (scenario === 'successor') source = 'done';
  if (isBlocked() && ['in_progress', 'done'].includes(source)) source = 'todo';
  task = makeTask(source);
  closeMenu();
  generation += 1;
  copyGeneration += 1; copyState = 'idle';
  clearPermissionToast();
  phase = 'idle'; feedbackKind = null; operation = null; remoteTask = null; reconciliations = 0; readFailureCount = 0;
  readReady = !['retained', 'loading', 'read-error', 'empty'].includes(scenario);
  detailOpen = true;
  $('source-status').value = source;
  render();
  if (scenario === 'empty-attachments') setTab('attachments');
  renderAttachment();
  $('attachment-scroll').scrollTop = 0;
  $('close-detail').focus();
};
const cancelConfirmation = (restore = true) => {
  if (confirmation === null) return;
  confirmation = null;
  $('confirmation-root').replaceChildren();
  $('detail-dialog').inert = false;
  if (restore) {
    if (priorFocus instanceof HTMLButtonElement && priorFocus.isConnected && !priorFocus.disabled) priorFocus.focus();
    else $('task-title').focus();
  }
};
const showConfirmation = (kind, target) => {
  if (!canWrite()) return;
  confirmation = { kind, source: task.status, target, version: task.version, taskTitle: title(), allowAgents: !task.allowAgents };
  priorFocus = document.activeElement;
  renderConfirmation();
};
const renderConfirmation = () => {
  const c = confirmation;
  if (c === null) return;
  $('detail-dialog').inert = true;
  const permission = c.kind === 'allowAgents';
  const heading = permission ? c.allowAgents ? m().enableTitle : m().disableTitle : m().confirmTitle;
  const details = permission ? `<p class="task-status-timing">${escape(m().permissionExplanation)}</p>` : `<div class="task-status-route">${statusBadge(c.source)}<span aria-hidden="true">→</span>${statusBadge(c.target)}</div><p class="task-status-timing">${escape(timingText(c.source, c.target))}</p>`;
  $('confirmation-root').innerHTML = `<div class="auth-modal-backdrop task-status-confirmation-backdrop"><section class="auth-dialog task-status-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-heading" aria-describedby="confirmation-description"><header class="dialog-header"><h2 id="confirmation-heading">${escape(heading)}</h2><button class="close-button" id="confirmation-close" type="button" aria-label="${escape(m().closeConfirmation)}">×</button></header><div class="dialog-body" id="confirmation-description" tabindex="0"><p>${escape(permission ? m().permissionQuestion : m().question)}</p><p class="task-status-confirmation-task">${escape(c.taskTitle)}</p>${details}<p>${escape(m().noAuthority)}</p></div><footer class="dialog-footer"><button class="button" type="button" id="confirmation-cancel">${escape(m().cancel)}</button><button class="button primary" type="button" id="confirmation-confirm">${escape(permission ? m().confirmPermission : m().confirm)}</button></footer></section></div>`;
  $('confirmation-cancel').addEventListener('click', () => cancelConfirmation());
  $('confirmation-close').addEventListener('click', () => cancelConfirmation());
  $('confirmation-confirm').addEventListener('click', () => submit(c));
  $('confirmation-root').firstElementChild.addEventListener('click', (event) => { if (event.target === event.currentTarget) cancelConfirmation(); });
  $('confirmation-cancel').focus();
};
const apply = (c) => {
  if (c.kind === 'allowAgents') { task.allowAgents = c.allowAgents; task.version += 1n; task.updatedAt = now(); return 'permissionChanged'; }
  if (c.source === c.target) return 'unchanged';
  if (c.target === 'in_progress') { task.startedAt = now(); task.completedAt = null; }
  else if (c.target === 'todo') { task.startedAt = null; task.completedAt = null; }
  else { if (c.source !== 'in_progress') task.startedAt = null; task.completedAt = now(); }
  task.status = c.target; task.version += 1n; task.updatedAt = now();
  return 'changed';
};
const submit = async (c) => {
  if (confirmation !== c || c.version !== task.version || c.source !== task.status) { cancelConfirmation(); feedbackKind = 'invalidated'; render(); return; }
  cancelConfirmation(false);
  operation = c;
  clearPermissionToast();
  const submittedGeneration = generation;
  phase = 'pending'; feedbackKind = c.kind === 'allowAgents' ? 'pendingPermission' : 'pending';
  events.push({ type: 'write', action: c.kind, status: c.target, version: String(c.version) });
  render(); $('task-title').focus();
  await new Promise((resolve) => setTimeout(resolve, 900));
  if (submittedGeneration !== generation) return;
  if (scenario === 'conflict') {
    task.version += 1n; task.changedElsewhere = true; events.push({ type: 'read', reason: 'conflict' });
    phase = 'conflict'; feedbackKind = 'conflict';
  } else if (c.version !== task.version) {
    events.push({ type: 'read', reason: 'conflict' }); phase = 'conflict'; feedbackKind = 'conflict';
  } else if (c.kind === 'status' && c.source !== c.target && ['in_progress', 'done'].includes(c.target) && isBlocked()) {
    phase = 'refused'; feedbackKind = 'dependencyError';
  } else if (c.kind === 'status' && c.source === 'done' && c.target !== 'done' && hasActiveSuccessor()) {
    phase = 'refused'; feedbackKind = 'successorError';
  } else {
    const reviewedTask = { ...task };
    const result = apply(c);
    if (scenario === 'unknown' || scenario === 'readback-failure') {
      remoteTask = { ...task }; task = reviewedTask;
      phase = 'unknown'; feedbackKind = 'uncertainty';
    } else { phase = 'confirmed'; feedbackKind = result; if (result === 'permissionChanged') showPermissionToast(); }
  }
  render();
};
const reconcile = async () => {
  if (phase !== 'unknown' && phase !== 'readback-failed') return;
  const readGeneration = generation;
  phase = 'checking'; feedbackKind = 'checking'; render();
  events.push({ type: 'read', reason: 'unknown', attempt: ++reconciliations });
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (readGeneration !== generation) return;
  if (scenario === 'readback-failure' && readFailureCount++ === 0) { phase = 'readback-failed'; feedbackKind = 'readbackFailure'; }
  else { if (remoteTask !== null) { task = remoteTask; remoteTask = null; } phase = 'reconciled'; feedbackKind = 'reconciled'; }
  render();
};

const closeMenu = () => {
  if (!menuOpen) return;
  $('status-menu').hidePopover();
  menuOpen = false;
  $('set-status').setAttribute('aria-expanded', 'false');
};
const openMenu = () => {
  if (!canWrite()) return;
  $('status-menu').innerHTML = statuses.map((status) => `<button type="button" role="menuitemradio" aria-checked="${status === task.status}" data-target="${status}"><span class="task-detail-relation-dot task-detail-dot-${status}" aria-hidden="true"></span><span>${escape(m().status[status])}</span><span class="task-status-check" aria-hidden="true">${status === task.status ? '✓' : ''}</span></button>`).join('');
  for (const item of $('status-menu').querySelectorAll('[data-target]')) item.addEventListener('click', () => { const target = item.dataset.target; closeMenu(); $('set-status').focus(); showConfirmation('status', target); });
  $('status-menu').showPopover();
  menuOpen = true;
  $('set-status').setAttribute('aria-expanded', 'true');
  const box = $('set-status').getBoundingClientRect();
  const height = $('status-menu').getBoundingClientRect().height;
  $('status-menu').style.top = `${box.bottom + height + 12 < innerHeight ? box.bottom + 6 : Math.max(8, box.top - height - 6)}px`;
  $('status-menu').style.left = `${Math.max(8, Math.min(box.right - 174, innerWidth - 182))}px`;
  $('status-menu').querySelector('[aria-checked=true]').focus();
};
document.addEventListener('pointerdown', (event) => { if (menuOpen && !$('status-menu').contains(event.target) && !$('set-status').contains(event.target)) closeMenu(); });


const clearPermissionToast = () => {
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = null;
  toastVisible = false;
};
const showPermissionToast = () => {
  clearPermissionToast();
  if (!detailOpen) return;
  toastVisible = true;
  toastTimer = window.setTimeout(() => { toastVisible = false; toastTimer = null; render(); }, 3000);
};
$('copy-task-id').addEventListener('click', async () => {
  const request = ++copyGeneration;
  copyState = 'pending'; render();
  try {
    await navigator.clipboard.writeText($('task-id').textContent);
    if (request === copyGeneration) copyState = 'copied';
  } catch {
    if (request === copyGeneration) copyState = 'failed';
  }
  if (request === copyGeneration) render();
});
const updateToolbarHeight = () => document.documentElement.style.setProperty('--prototype-toolbar-height', `${Math.ceil(document.querySelector('.prototype-tools').getBoundingClientRect().height)}px`);
new ResizeObserver(updateToolbarHeight).observe(document.querySelector('.prototype-tools'));
updateToolbarHeight();

$('language').addEventListener('change', () => { language = $('language').value; render(); renderAttachment(); if (confirmation !== null) renderConfirmation(); });
$('fixture').addEventListener('change', () => loadScenario($('fixture').value));
$('source-status').addEventListener('change', () => loadScenario(scenario, sourceState()));
$('set-status').addEventListener('click', () => menuOpen ? closeMenu() : openMenu());
$('automation-switch').addEventListener('click', () => { if (task.status !== 'in_progress') showConfirmation('allowAgents', null); });
$('reset').addEventListener('click', () => loadScenario(scenario, sourceState()));
$('poll-change').addEventListener('click', () => { task.version += 1n; task.changedElsewhere = true; if (confirmation !== null) { cancelConfirmation(); feedbackKind = 'invalidated'; } render(); });
const closeDetail = () => {
  detailOpen = false; clearPermissionToast();
  copyGeneration += 1; copyState = 'idle';
  render(); $('open-detail').focus();
};
$('close-detail').addEventListener('click', closeDetail);
$('open-detail').addEventListener('click', () => { detailOpen = true; render(); $('close-detail').focus(); });
for (const tab of tabs) {
  $(`${tab}-tab`).addEventListener('click', () => activateTab(tab));
  $(`${tab}-tab`).addEventListener('keydown', (event) => navigateTabs(event, tab));
}
for (const button of document.querySelectorAll('[data-file]')) button.addEventListener('click', () => { activeFile = button.dataset.file; attachmentNotice = false; renderAttachment(); $('attachment-scroll').scrollTop = 0; });
$('new-tab').addEventListener('click', () => { attachmentNotice = true; renderAttachmentFeedback(); });
document.addEventListener('keydown', (event) => {
  if (menuOpen) {
    const items = [...$('status-menu').querySelectorAll('[role=menuitemradio]')];
    const current = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    if (event.key === 'ArrowUp') next = (current + items.length - 1) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next !== null) { event.preventDefault(); items[next].focus(); return; }
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); $('set-status').focus(); return; }
    if (event.key === 'Tab') closeMenu();
  }
  if (confirmation !== null) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelConfirmation(); }
    if (event.key === 'Tab') {
      const root = $('confirmation-root');
      const items = [...root.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
      const first = items[0]; const last = items[items.length - 1];
      if (!root.contains(document.activeElement) || !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    }
  } else if (detailOpen && event.key === 'Escape') { event.preventDefault(); closeDetail(); }
  else if (detailOpen && event.key === 'Tab') {
    const items = [...$('detail-dialog').querySelectorAll('button:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter((item) => item.getClientRects().length > 0 && !item.closest('[hidden]'));
    const first = items[0]; const last = items[items.length - 1];
    if (!$('detail-dialog').contains(document.activeElement) || !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  }
});
window.prototype = {
  events,
  get state() { return { status: task.status, version: String(task.version), startedAt: task.startedAt, completedAt: task.completedAt, updatedAt: task.updatedAt, allowAgents: task.allowAgents, phase, activeTab, activeFile, copyState, toastVisible, confirmation: confirmation === null ? null : { ...confirmation, version: String(confirmation.version) } }; },
  load: loadScenario,
  setLanguage: (next) => { language = next; render(); renderAttachment(); },
};
renderStatusOptions('source-status', 'todo');
loadScenario('normal', 'todo');
