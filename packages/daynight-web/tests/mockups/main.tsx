import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AttachmentPage } from '../../src/features/task-detail/attachments/AttachmentPage';
import { useBodyScrollLock } from '../../src/app/useBodyScrollLock';
import { TaskDetailReading } from '../../src/features/task-detail/TaskDetailReading';
import { TaskPullRequests } from '../../src/features/task-detail/TaskPullRequests';
import { LocaleProvider, useI18n } from '../../src/i18n/LocaleProvider';
import { LanguageSelector } from '../../src/i18n/LanguageSelector';
import { resolveInitialLocale } from '../../src/i18n/locale';
import { createAttachmentFixture, type MockupScenario } from './fixture';
import '../../src/styles/app.css';
import '../../src/styles/task-detail.css';

const query = new URLSearchParams(window.location.search);
const standalonePath = query.get('file');
const markdownColumns = Array.from({ length: 12 }, (_, index) => `字段 ${index + 1}`);
const markdownDescription = [
  '# 任务描述 Markdown', '',
  '在当前任务中阅读 **交付目标**、English identifiers 和实际资料。', '',
  '## 目标与范围', '',
  '- 查看方案、图片和交互原型', '- [x] 使用真实附件相对路径', '',
  '> 方案和验收保存在主 Markdown 附件中，描述保留简短可观察的完成条件。', '',
  `| ${markdownColumns.join(' | ')} |`, `| ${markdownColumns.map(() => '---').join(' | ')} |`, `| ${markdownColumns.map(() => 'Long table content').join(' | ')} |`, '',
  '```typescript', `const task = { description: '${'Markdown reference '.repeat(40)}' };`, '```', '',
  '![任务流程](images/workflow.svg)', '',
  '[方案与验收](docs/guide.md) · [交互原型](site/index.html) · [完整阅读](docs/tall.md)', '',
  '[缺失附件](missing.md) · [越界引用](../outside.md) · [原生查询链接](docs/guide.md?raw=1#section)', '',
  '<script>window.descriptionLeak = true</script>', '',
].join('\n');

const AttachmentMockup = () => {
  const { locale, messages, format } = useI18n();
  const m = messages.inspection.detail;
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = messages.workspace.app.documentTitle[standalonePath === null ? 'project' : 'attachment'];
  }, [locale, messages]);
  const [scenario, setScenario] = useState<MockupScenario>((query.get('scenario') ?? 'files') as MockupScenario);
  const [open, setOpen] = useState(true);
  const [descriptionMode, setDescriptionMode] = useState<'rich' | 'empty' | 'long'>('rich');
  const description = descriptionMode === 'empty' ? '' : descriptionMode === 'long' ? `${markdownDescription}\n\n${Array.from({ length: 24 }, (_, index) => `### 验收记录 ${index + 1}\n\n完整任务描述在概览中滚动。方案链接激活现有附件页签，保留同一个文件清单和预览控制器。`).join('\n\n')}` : markdownDescription;
  useBodyScrollLock(open && standalonePath === null);
  const fixture = useMemo(() => createAttachmentFixture(scenario), [scenario]);
  useEffect(() => () => fixture.dispose(), [fixture]);
  if (standalonePath !== null) return <AttachmentPage projectId="mockup-project" taskId="mockup-task" path={standalonePath} api={fixture.api} urls={fixture.urls} />;
  return <>
    <main className="content"><LanguageSelector /><p className="eyebrow">DAYNIGHT</p><h1>任务附件交互预览</h1><p className="subtitle">开发环境中的前端 fixture；上传、覆盖和删除保存在当前页面。</p><p style={{ marginTop: 20 }}><button className="button primary" type="button" onClick={() => setOpen(true)}>打开任务详情</button></p></main>
    {open && <div className="task-detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section className="task-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="mockup-heading">
      <header className="task-detail-header"><h2 id="mockup-heading">{m.title}</h2><LanguageSelector /><button className="button task-detail-close" type="button" aria-label={m.close} onClick={() => setOpen(false)}>×</button></header>
      <div className="task-detail-body">
        <div className="task-detail-heading">
          <p className="task-detail-id">00000000-0000-4000-8000-000000000001</p><h3 className="task-detail-title">为项目补充设计与交互附件</h3><div className="task-detail-badges"><span className="task-detail-status task-detail-status-in_progress">{messages.common.status.in_progress}</span></div>
        </div>
        <TaskDetailReading key={scenario} projectId="mockup-project" taskId="mockup-task" description={description} api={fixture.api} urls={fixture.urls} onClose={() => setOpen(false)} overview={(renderedDescription) => <div className="task-detail-columns">
          <div className="task-detail-main">
            <section className="task-detail-section">
              <label className="attachment-hint" htmlFor="mockup-scenario">预览场景 </label><select className="task-detail-pr-page-select" id="mockup-scenario" value={scenario} onChange={(event) => setScenario(event.currentTarget.value as MockupScenario)}><option value="files">目录与多种格式</option><option value="empty">暂无附件</option><option value="upload-error">上传失败</option><option value="loading">列表加载中</option><option value="list-error">列表加载失败</option><option value="preview-error">预览失败</option><option value="busy">上传持续处理中</option><option value="delete-error">删除失败后重试</option><option value="delete-pending">删除持续处理中</option></select><label className="attachment-hint" htmlFor="mockup-description"> 描述内容 </label><select id="mockup-description" value={descriptionMode} onChange={(event) => setDescriptionMode(event.currentTarget.value as typeof descriptionMode)}><option value="rich">Markdown 与实际资料</option><option value="empty">空描述</option><option value="long">长描述</option></select>
            </section>
            <section className="task-detail-section" aria-label={m.description}><h4>{m.description}</h4>{renderedDescription}</section>
            <TaskPullRequests pullRequests={[{ title: 'Add task attachments to the task detail dialog', url: 'https://github.com/example/project/pull/42' }]} />
          </div>
          <aside className="task-detail-aside" aria-label={m.relationsMetadata}>
            <section className="task-detail-section" aria-label={m.dependencies}><h4>{m.countedHeading({ label: m.dependencies, count: format.number(0) })}</h4><p className="task-detail-description">{m.noDependencies}</p></section>
            <section className="task-detail-section" aria-label={m.blockers}><h4>{m.countedHeading({ label: m.blockers, count: format.number(0) })}</h4><p className="task-detail-description">{m.noBlockers}</p></section>
            <section className="task-detail-section" aria-label={m.successors}><h4>{m.countedHeading({ label: m.successors, count: format.number(0) })}</h4><p className="task-detail-description">{m.noSuccessors}</p></section>
            <dl className="task-detail-section task-detail-metadata"><div><dt>{m.created}</dt><dd>{format.dateTime('2026-10-21T10:00:00Z')}</dd></div><div><dt>{m.updated}</dt><dd>{format.dateTime('2026-10-22T09:00:00Z')}</dd></div><div><dt>{m.taskId}</dt><dd className="task-detail-full-id">00000000-0000-4000-8000-000000000001</dd></div></dl>
          </aside>
        </div>} />
      </div><footer className="task-detail-footer">{m.footer}</footer>
    </section></div>}
  </>;
};

const root = document.getElementById('root');
if (root === null) throw new Error('The mockup root is required.');
const initial = resolveInitialLocale();
createRoot(root).render(<LocaleProvider initial={initial}><AttachmentMockup /></LocaleProvider>);
