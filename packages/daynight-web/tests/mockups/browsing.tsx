import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectPage } from '../../src/features/projects/ProjectPage';
import { browsingProjects, installBrowsingFixture, type BrowsingScenario } from './browsing-fixture';
import '../../src/styles/app.css';

const readScenario = (): BrowsingScenario => {
  const hash = location.hash.slice(1);
  return hash === 'external' || hash === 'complete' || hash === 'empty' ? hash : 'mixed';
};

const BrowsingMockup = () => {
  const [scenario, setScenario] = useState(readScenario);
  const scenarioSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const updateScenario = () => setScenario(readScenario());
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
      }}>跳到主要内容</a>
      <aside className="sidebar" aria-label="工作空间导航">
        <a className="brand" href="/" aria-label="Daynight 项目首页">
          <span className="brand-mark" aria-hidden="true" />daynight
        </a>
        <nav aria-label="主导航">
          <p className="nav-label">工作空间</p>
          <a className="nav-button" href="/" aria-current="page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            项目
          </a>
        </nav>
        <div className="sidebar-bottom">本地工作空间<small>任务与依赖，一处看清</small></div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <nav className="crumb" aria-label="面包屑">
            <a href="/">工作空间</a><span aria-hidden="true">/</span>
            <span className="crumb-current" aria-current="page">项目任务</span>
          </nav>
          <span className="local-label">工作空间 · 本地</span>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          <section className="snapshot-notice" aria-label="预览场景" style={{ margin: '0 0 24px' }}>
            <label htmlFor="browsing-scenario">任务链浏览交互预览 · 项目场景 </label>
            <select
              id="browsing-scenario" ref={scenarioSelect} value={scenario}
              onChange={(event) => { location.hash = event.currentTarget.value; }}
            >
              <option value="mixed">混合状态与共享依赖</option>
              <option value="external">完整上游与无关分支排除</option>
              <option value="complete">全部完成</option>
              <option value="empty">尚无任务</option>
            </select>
            <p>两个页签旁的数字均表示未完成任务数，任务链中的共享任务跨链只计一次，显示已完成项不改变数字。任务链状态汇总根及全部后续任务：全部完成才显示已完成，有任务开始或完成后显示进行中，全部待处理时显示待处理。图中补齐全部上游前置，外部前置保留自身状态，不计入链内进度，也不引入其无关后续。任务链按创建时间倒序排列，浏览设置按项目保存；点击图内卡片追踪全部前置及平滑连线，再次点击或点空白处清除；点击独立的“详情”入口阅读任务。Tab 分别聚焦主体与详情，Enter/空格执行对应动作。展开图后可全屏查看、缩放，Esc 先关闭详情，再退出全屏。</p>
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
const root = createRoot(container);
root.render(<BrowsingMockup />);
import.meta.hot?.dispose(() => { root.unmount(); disposeFixture(); });
