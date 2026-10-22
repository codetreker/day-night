import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskAttachments } from '../../src/features/task-detail/attachments/TaskAttachments';
import { TaskPullRequests } from '../../src/features/task-detail/TaskPullRequests';
import { createAttachmentFixture, type MockupScenario } from './fixture';
import '../../src/styles/app.css';
import '../../src/styles/task-detail.css';

const AttachmentMockup = () => {
  const [scenario, setScenario] = useState<MockupScenario>('files');
  const [open, setOpen] = useState(true);
  const fixture = useMemo(() => createAttachmentFixture(scenario), [scenario]);
  useEffect(() => () => fixture.dispose(), [fixture]);
  return <>
    <main className="content"><p className="eyebrow">DAYNIGHT</p><h1>任务附件交互预览</h1><p className="subtitle">开发环境中的前端 fixture；上传、覆盖和删除保存在当前页面。</p><p style={{ marginTop: 20 }}><button className="button primary" type="button" onClick={() => setOpen(true)}>打开任务详情</button></p></main>
    {open && <div className="task-detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section className="task-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="mockup-heading">
      <header className="task-detail-header"><h2 id="mockup-heading">任务详情</h2><button className="button task-detail-close" type="button" aria-label="关闭任务详情" onClick={() => setOpen(false)}>×</button></header>
      <div className="task-detail-body">
        <div className="task-detail-heading">
          <p className="task-detail-id">00000000-0000-4000-8000-000000000001</p><h3 className="task-detail-title">为项目补充设计与交互附件</h3><div className="task-detail-badges"><span className="task-detail-status task-detail-status-in_progress">进行中</span></div>
          <label className="attachment-hint" htmlFor="mockup-scenario">预览场景 </label><select className="task-detail-pr-page-select" id="mockup-scenario" value={scenario} onChange={(event) => setScenario(event.currentTarget.value as MockupScenario)}><option value="files">目录与多种格式</option><option value="empty">暂无附件</option><option value="upload-error">上传失败</option></select>
        </div>
        <div className="task-detail-columns">
          <div className="task-detail-main">
            <section className="task-detail-section" aria-label="描述"><h4>描述</h4><p className="task-detail-description">浏览设计文档、图片、PDF、JSON 和可交互 HTML。选择文件后可在附件区域直接预览。</p></section>
            <TaskPullRequests pullRequests={[{ title: 'Add task attachments to the task detail dialog', url: 'https://github.com/example/project/pull/42' }]} />
            <TaskAttachments key={scenario} projectId="mockup-project" taskId="mockup-task" api={fixture.api} urls={fixture.urls} onClose={() => setOpen(false)} />
          </div>
          <aside className="task-detail-aside" aria-label="任务关系与元数据">
            <section className="task-detail-section" aria-label="前置依赖"><h4>前置依赖 · 0</h4><p className="task-detail-description">无前置依赖</p></section>
            <section className="task-detail-section" aria-label="当前未完成的前置"><h4>当前未完成的前置 · 0</h4><p className="task-detail-description">所有前置已完成</p></section>
            <section className="task-detail-section" aria-label="任务图快照中的直接后续"><h4>任务图快照中的直接后续 · 0</h4><p className="task-detail-description">无后续任务</p></section>
            <dl className="task-detail-section task-detail-metadata"><div><dt>创建时间</dt><dd>2026/10/21 10:00:00</dd></div><div><dt>更新时间</dt><dd>2026/10/22 09:00:00</dd></div><div><dt>任务 ID</dt><dd className="task-detail-full-id">00000000-0000-4000-8000-000000000001</dd></div></dl>
          </aside>
        </div>
      </div><footer className="task-detail-footer">前置与阻塞项来自最新详情，名称与后续关系来自任务图快照。</footer>
    </section></div>}
  </>;
};

const root = document.getElementById('root');
if (root === null) throw new Error('The mockup root is required.');
createRoot(root).render(<AttachmentMockup />);
