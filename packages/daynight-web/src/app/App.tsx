import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { ProjectPage } from '../features/projects/ProjectPage';
import { navigate, parseRoute } from './router';

const goToProjects = (event: MouseEvent<HTMLAnchorElement>) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate('/');
};

export const App = () => {
  const [pathname, setPathname] = useState(window.location.pathname);
  const content = useRef<HTMLElement>(null);
  const route = parseRoute(pathname);

  useEffect(() => {
    const onNavigate = () => {
      setPathname(window.location.pathname);
    };
    window.addEventListener('popstate', onNavigate);
    return () => { window.removeEventListener('popstate', onNavigate); };
  }, []);

  useLayoutEffect(() => { content.current?.focus(); }, [pathname]);

  useEffect(() => {
    document.title = route.kind === 'projects' ? '项目 · Daynight' : route.kind === 'project' ? '项目任务 · Daynight' : '页面不存在 · Daynight';
  }, [route.kind]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className="sidebar" aria-label="工作空间导航">
        <a className="brand" href="/" onClick={goToProjects} aria-label="Daynight 项目首页">
          <span className="brand-mark" aria-hidden="true" />daynight
        </a>
        <nav aria-label="主导航">
          <p className="nav-label">工作空间</p>
          <a className="nav-button" href="/" onClick={goToProjects} aria-current={route.kind === 'notFound' ? undefined : 'page'}>
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
            <a href="/" onClick={goToProjects}>工作空间</a>
            <span aria-hidden="true">/</span>
            <span className="crumb-current" aria-current="page">{route.kind === 'projects' ? '项目' : route.kind === 'project' ? '项目任务' : '页面不存在'}</span>
          </nav>
          <span className="local-label">工作空间 · 本地</span>
        </header>
        <main className="content" id="main-content" ref={content} tabIndex={-1}>
          {route.kind === 'projects' ? <ProjectsPage /> : route.kind === 'project' ? <ProjectPage key={route.projectId} projectId={route.projectId} /> : (
            <section className="state-box">
              <p className="eyebrow">404</p>
              <h1>页面不存在</h1>
              <p>请检查页面地址，或返回项目列表。</p>
              <a className="button primary" href="/" onClick={goToProjects}>返回项目列表</a>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};
