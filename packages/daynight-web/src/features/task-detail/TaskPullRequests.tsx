import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PullRequestProperty } from '../../api/types';

const pageSize = 100;

const isWebLink = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const TaskPullRequests = ({ pullRequests }: { readonly pullRequests: readonly PullRequestProperty[] }) => {
  const [selection, setSelection] = useState({ collection: pullRequests, page: 0 });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const focusedElement = useRef<HTMLElement | null>(null);
  const pageId = useId();
  const page = selection.collection === pullRequests ? selection.page : 0;
  if (selection.collection !== pullRequests) {
    // Reset before commit so a replacement collection never displays an old page.
    setSelection({ collection: pullRequests, page: 0 });
  }
  const pageCount = Math.ceil(pullRequests.length / pageSize);
  const start = page * pageSize;
  const visible = pullRequests.slice(start, start + pageSize);

  useLayoutEffect(() => {
    const previous = focusedElement.current;
    if (previous !== null && (!previous.isConnected || (previous instanceof HTMLButtonElement && previous.disabled))) {
      if (selectRef.current !== null) selectRef.current.focus();
      else headingRef.current!.focus();
    }
  }, [pullRequests, page]);

  return (
    <section className="task-detail-section" aria-label="关联 PR"
      onFocusCapture={(event) => { focusedElement.current = event.target; }}
      onBlurCapture={(event) => {
        if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) focusedElement.current = null;
      }}>
      <h4 ref={headingRef} tabIndex={-1}>关联 PR · {pullRequests.length}</h4>
      {pageCount > 1 && (
        <div className="task-detail-pr-pagination">
          <p className="task-detail-pr-range" role="status" aria-live="polite" aria-atomic="true">第 {start + 1}–{start + visible.length} 项，共 {pullRequests.length} 项</p>
          <div className="task-detail-pr-page-controls">
            <button className="button" type="button" disabled={page === 0}
              onClick={() => setSelection({ collection: pullRequests, page: page - 1 })}>上一页</button>
            <label className="task-detail-pr-page-label" htmlFor={pageId}>页码</label>
            <select className="task-detail-pr-page-select" id={pageId} ref={selectRef} aria-label="关联 PR 页码" value={page}
              onChange={(event) => setSelection({ collection: pullRequests, page: Number(event.currentTarget.value) })}>
              {Array.from({ length: pageCount }, (_, index) => <option key={index} value={index}>{index + 1} / {pageCount}</option>)}
            </select>
            <button className="button" type="button" disabled={page === pageCount - 1}
              onClick={() => setSelection({ collection: pullRequests, page: page + 1 })}>下一页</button>
          </div>
        </div>
      )}
      {pullRequests.length === 0 ? <p className="task-detail-description">暂无关联 PR</p> : (
        <ul className="task-detail-pr-list">
          {visible.map(({ title, url }, index) => {
            const link = isWebLink(url);
            const value = url === '' ? '（空字符串）' : url;
            return (
              <li className="task-detail-pr" key={start + index}>
                <p className={`task-detail-pr-title${title === '' ? ' task-detail-pr-empty' : ''}`}>{title === '' ? '（空字符串）' : title}</p>
                <div className="task-detail-pr-url">
                  <span className="task-detail-pr-label">URL</span>
                  {link
                    ? <a className="task-detail-pr-value" href={url} target="_blank" rel="noopener noreferrer">{value}</a>
                    : <span className={`task-detail-pr-value${url === '' ? ' task-detail-pr-empty' : ''}`}>{value}</span>}
                  {link && <span className="task-detail-pr-external" aria-hidden="true">↗</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
