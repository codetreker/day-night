import type { MouseEvent } from 'react';
import { ApiError } from '../../api/client';
import { navigate } from '../../app/router';
import { useProjects } from './useProjects';

const FolderIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    <path d="M3 9h18" />
  </svg>
);

const ArrowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M5 12h14m-5-5 5 5-5 5" />
  </svg>
);

const openProject = (event: MouseEvent<HTMLAnchorElement>) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(event.currentTarget.pathname);
};

const ErrorDetail = ({ error }: { error: unknown }) => (
  <>
    <p>{error instanceof ApiError && error.kind === 'network'
      ? '无法连接服务，请检查本地服务后重试。'
      : '暂时无法读取项目，请重试。'}</p>
    {error instanceof ApiError && error.requestId !== null && (
      <p className="request-id">请求 ID：<code>{error.requestId}</code></p>
    )}
  </>
);

export const ProjectsPage = () => {
  const projects = useProjects();

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">工作空间</p>
          <h1 id="page-title" tabIndex={-1}>项目</h1>
          <p className="subtitle">从项目出发，查看任务进度与执行依赖。</p>
        </div>
        <button className="button" type="button" onClick={projects.refresh}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" />
          </svg>
          刷新
        </button>
      </div>

      {projects.status === 'loading' && (
        <section className="state-box" role="status" aria-label="正在加载项目">
          <span className="spinner" aria-hidden="true" />
          <h2>正在加载项目</h2>
          <p>正在读取工作空间中的项目。</p>
        </section>
      )}

      {projects.status === 'error' && (
        <section className="state-box" role="alert">
          <div className="state-icon"><FolderIcon /></div>
          <h2>项目加载失败</h2>
          <ErrorDetail error={projects.error} />
          <button className="button primary" type="button" onClick={projects.refresh}>重试</button>
        </section>
      )}

      {projects.status === 'ready' && projects.items.length === 0 && (
        <section className="state-box">
          <div className="state-icon"><FolderIcon /></div>
          <h2>还没有项目</h2>
          <p>通过 API 创建项目后，点击刷新即可在这里查看。</p>
        </section>
      )}

      {projects.status === 'ready' && projects.items.length > 0 && (
        <ul className="project-grid" aria-label="项目列表">
          {projects.items.map((project) => (
            <li key={project.id}>
              <a className="project-card" href={`/projects/${project.id}`} onClick={openProject}>
                <span className="project-icon"><FolderIcon /></span>
                <h2 className="project-name">{project.name}</h2>
                <p className="repo">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <path d="M4 19V5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1 0-4h13M8 7h7M8 10h5" />
                  </svg>
                  <span>{project.repoUrl}</span>
                </p>
                <div className="project-footer">
                  <span>创建于 <time dateTime={project.createdAt}>{new Date(project.createdAt).toLocaleDateString('zh-CN')}</time></span>
                  <span className="project-open">查看任务 <ArrowIcon /></span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      {projects.status === 'ready' && projects.nextCursor !== null && (
        <div className="list-footer">
          {projects.moreError !== null && (
            <div className="continuation-error" role="alert">
              <p className="error-title">更多项目加载失败，已加载的项目仍可查看。</p>
              <ErrorDetail error={projects.moreError} />
            </div>
          )}
          <button className="button" type="button" onClick={projects.loadMore} disabled={projects.loadingMore}>
            {projects.loadingMore ? '正在加载更多…' : projects.moreError !== null ? '重试加载更多' : '加载更多'}
          </button>
        </div>
      )}
      {projects.status === 'ready' && projects.items.length > 0 && projects.nextCursor === null && (
        <p className="list-footer">已加载全部项目</p>
      )}
    </>
  );
};
