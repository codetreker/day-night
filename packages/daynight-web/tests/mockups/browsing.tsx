import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectPage } from '../../src/features/projects/ProjectPage';
import { LocaleProvider, useI18n } from '../../src/i18n/LocaleProvider';
import { LanguageSelector } from '../../src/i18n/LanguageSelector';
import { resolveInitialLocale } from '../../src/i18n/locale';
import { browsingProjects, browsingScenarioLabels, installBrowsingFixture, readBrowsingDetailScenario, readBrowsingScenario, type BrowsingDetailScenario, type BrowsingScenario } from './browsing-fixture';
import '../../src/styles/app.css';

const BrowsingMockup = () => {
  const { locale, messages } = useI18n();
  const m = messages.workspace.app;
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = m.documentTitle.project;
  }, [locale, m]);
  const [scenario, setScenario] = useState(readBrowsingScenario);
  const [detailScenario, setDetailScenario] = useState(readBrowsingDetailScenario);
  const scenarioSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const updateScenario = () => setScenario(readBrowsingScenario());
    window.addEventListener('hashchange', updateScenario);
    return () => window.removeEventListener('hashchange', updateScenario);
  }, []);

  const keepPreviewLocation = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element) || event.target.closest('a[href="/"]') === null) return;
    event.preventDefault();
    event.stopPropagation();
    scenarioSelect.current?.focus();
  };

  return (
    <div className="shell" onClickCapture={keepPreviewLocation}>
      <a className="skip-link" href="#main-content" onClick={(event) => {
        event.preventDefault();
        document.getElementById('main-content')?.focus();
      }}>{m.skipToContent}</a>
      <aside className="sidebar" aria-label={m.workspaceNavigation}>
        <a className="brand" href="/" aria-label={m.projectHome}>
          <span className="brand-mark" aria-hidden="true" />daynight
        </a>
        <nav aria-label={m.mainNavigation}>
          <p className="nav-label">{m.workspace}</p>
          <a className="nav-button" href="/" aria-current="page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            {m.projects}
          </a>
        </nav>
        <div className="sidebar-bottom">{m.localWorkspace}<small>{m.localWorkspaceDetail}</small></div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <nav className="crumb" aria-label={m.breadcrumb}>
            <a href="/">{m.workspace}</a><span aria-hidden="true">/</span>
            <span className="crumb-current" aria-current="page">{m.projectTasks}</span>
          </nav>
          <div className="topbar-tools"><span className="local-label">{m.localLabel}</span><LanguageSelector /></div>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          <section className="snapshot-notice" aria-label="预览场景" style={{ margin: '0 0 24px' }}>
            <label htmlFor="browsing-scenario">任务链浏览交互预览 · 项目场景 </label>
            <select
              id="browsing-scenario" ref={scenarioSelect} value={scenario}
              onChange={(event) => { location.hash = event.currentTarget.value; }}
            >
              {(Object.keys(browsingScenarioLabels) as BrowsingScenario[]).map((key) => <option key={key} value={key}>{browsingScenarioLabels[key]}</option>)}
            </select>
            <label htmlFor="browsing-detail-scenario"> 详情内容 </label>
            <select id="browsing-detail-scenario" value={detailScenario} onChange={(event) => {
              const next = event.currentTarget.value as BrowsingDetailScenario;
              const url = new URL(location.href);
              url.searchParams.set('detail', next);
              history.replaceState(null, '', url);
              setDetailScenario(next);
            }}>
              <option value="normal">任务内容与关系</option>
              <option value="long">长描述</option>
              <option value="empty">空描述</option>
              <option value="loading">详情加载中</option>
              <option value="error">详情加载失败</option>
            </select>
            <p>两个页签旁的数字均表示未完成任务数，任务链中的共享任务跨链只计一次，显示已完成项不改变数字。任务链状态汇总根及全部后续任务：全部完成才显示已完成，有任务开始或完成后显示进行中，有待处理任务时显示待处理，其余全部待审批时显示待审批。待审批任务始终不可开始，未完成前置仍完整显示。图的完整投影包含全部上游前置，外部前置保留自身状态，不计入链内进度，也不引入其无关后续。超过 50 个任务或 100 条依赖时先显示根锚定概览，卡片底部控件每次最多展开 20 个直接前置或后续并显示新增任务、依赖和剩余数量；收起到概览恢复初始范围。卡片主体追踪全部前置，另有多少上游未展开会单独显示；独立的详情按钮打开任务，展开控件分开操作，刷新保留当前实际可见任务。依赖选择和详情不会展开任务或移动画布。任务链按创建时间倒序排列，浏览设置按项目保存；展开图后可全屏查看、缩放和打开详情，Esc 先关闭详情，再退出全屏。</p>
          </section>
          <ProjectPage key={scenario} projectId={browsingProjects[scenario].project.id} />
        </main>
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container === null) throw new Error('The browsing mockup root is required.');
const disposeFixture = installBrowsingFixture();
const initial = resolveInitialLocale();
const root = createRoot(container);
root.render(<LocaleProvider initial={initial}><BrowsingMockup /></LocaleProvider>);
import.meta.hot?.dispose(() => { root.unmount(); disposeFixture(); });
