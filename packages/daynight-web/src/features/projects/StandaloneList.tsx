import { useRef } from "react";
import { useI18n } from "../../i18n/LocaleProvider";
import type { GraphIndex } from "../task-graph/model";
import "../../styles/graph.css";

type StandaloneListProps = {
  readonly index: GraphIndex;
  readonly taskIds: readonly string[];
  readonly allTaskIds: readonly string[];
  readonly onSelectTask: (id: string, trigger: HTMLElement) => void;
  readonly showCompleted: boolean;
  readonly onShowCompletedChange: (show: boolean) => void;
};

export const StandaloneList = ({ index, taskIds, allTaskIds, onSelectTask, showCompleted, onShowCompletedChange }: StandaloneListProps) => {
  const { messages: { workspace: { standalone: m, project }, common }, format } = useI18n();
  const checkbox = useRef<HTMLInputElement>(null);
  const completedCount = allTaskIds.filter((id) => index.nodes.get(id)!.status === "done").length;
  return (
    <section aria-label={m.list}>
      <div className="task-view-toolbar">
        {allTaskIds.length > 0 && <label className="completed-chain-control"><input ref={checkbox} type="checkbox" checked={showCompleted} onChange={(event) => { onShowCompletedChange(event.currentTarget.checked); }} />{m.showCompletedCount({ count: completedCount })}</label>}
        <span className="task-view-summary" aria-label={m.summaryLabel({ visible: taskIds.length, total: allTaskIds.length })}>{m.summary({ visible: taskIds.length, total: allTaskIds.length })}</span>
      </div>
      <p className="graph-note">{m.explanation}</p>
      {allTaskIds.length === 0 ? (
        <div className="state-box"><h3>{m.empty}</h3><p>{m.emptyDetail}</p></div>
      ) : taskIds.length === 0 ? (
        <div className="state-box completed-chains-empty"><h3>{m.allCompleted}</h3><p>{m.hiddenCompleted({ count: completedCount })}</p>
          <button className="button" type="button" onClick={() => { checkbox.current!.focus(); onShowCompletedChange(true); }}>{m.showCompleted}</button>
        </div>
      ) : (
        <ul className="standalone-list">{taskIds.map((id) => {
          const task = index.nodes.get(id)!;
          return <li key={id}><button className="standalone-row" id={`standalone-task-${id}`} type="button" onClick={(event) => { onSelectTask(id, event.currentTarget); }}>
            <span className="root-heading"><span className="root-title">{task.titlePreview}{task.titleTruncated ? "…" : ""}</span>
              <span className="root-meta"><span className="standalone-task-id">{id}</span> · <time dateTime={task.createdAt}>{m.createdOn({ date: format.date(task.createdAt) })}</time></span></span>
            <span className="task-row-status"><span className={`root-status graph-status-${task.status}`}>{common.status[task.status]}</span>{task.ready && <span className="task-ready">{project.ready}</span>}</span>
            <svg className="standalone-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button></li>;
        })}</ul>
      )}
    </section>
  );
};
