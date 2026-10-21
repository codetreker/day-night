import type { PullRequestProperty } from '../../api/types';

const isWebLink = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const TaskPullRequests = ({ pullRequests }: { readonly pullRequests: readonly PullRequestProperty[] }) => (
  <section className="drawer-section" aria-label="关联 PR">
    <h4>关联 PR · {pullRequests.length}</h4>
    {pullRequests.length === 0 ? <p className="drawer-description">暂无关联 PR</p> : (
      <ul className="drawer-pr-list">
        {pullRequests.map(({ title, url }, index) => {
          const link = isWebLink(url);
          const value = url === '' ? '（空字符串）' : url;
          return (
            <li className="drawer-pr" key={index}>
              <p className={`drawer-pr-title${title === '' ? ' drawer-pr-empty' : ''}`}>{title === '' ? '（空字符串）' : title}</p>
              <div className="drawer-pr-url">
                <span className="drawer-pr-label">URL</span>
                {link
                  ? <a className="drawer-pr-value" href={url} target="_blank" rel="noopener noreferrer">{value}</a>
                  : <span className={`drawer-pr-value${url === '' ? ' drawer-pr-empty' : ''}`}>{value}</span>}
                {link && <span className="drawer-pr-external" aria-hidden="true">↗</span>}
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);
