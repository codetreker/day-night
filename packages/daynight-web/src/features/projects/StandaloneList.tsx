import { useRef } from "react";
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

const labels = { todo: "待处理", in_progress: "进行中", done: "已完成" };

export const StandaloneList = ({ index, taskIds, allTaskIds, onSelectTask, showCompleted, onShowCompletedChange }: StandaloneListProps) => {
  const checkbox = useRef<HTMLInputElement>(null);
  const completedCount = allTaskIds.filter((id) => index.nodes.get(id)!.status === "done").length;
  return (
    <section aria-label="独立任务列表">
      <div className="task-view-toolbar">
        {allTaskIds.length > 0 && <label className="completed-chain-control"><input ref={checkbox} type="checkbox" checked={showCompleted} onChange={(event) => { onShowCompletedChange(event.currentTarget.checked); }} />显示已完成独立任务（{completedCount}）</label>}
        <span className="task-view-summary">最新创建在前 · <span aria-label={`显示 ${taskIds.length} 个，共 ${allTaskIds.length} 个独立任务`}>{taskIds.length} / {allTaskIds.length}</span> 个独立任务</span>
      </div>
      <p className="graph-note">按创建时间倒序排列。独立任务没有前置或后续依赖，点击任务直接查看详情。</p>
      {allTaskIds.length === 0 ? (
        <div className="state-box"><h3>暂无独立任务</h3><p>当前任务均有依赖关系，可在任务链页签查看。</p></div>
      ) : taskIds.length === 0 ? (
        <div className="state-box completed-chains-empty"><h3>所有独立任务已完成</h3><p>已隐藏 {completedCount} 个已完成独立任务，项目统计仍包含全部任务。</p>
          <button className="button" type="button" onClick={() => { checkbox.current!.focus(); onShowCompletedChange(true); }}>显示已完成独立任务</button>
        </div>
      ) : (
        <ul className="standalone-list">{taskIds.map((id) => {
          const task = index.nodes.get(id)!;
          return <li key={id}><button className="standalone-row" id={`standalone-task-${id}`} type="button" onClick={(event) => { onSelectTask(id, event.currentTarget); }}>
            <span className="root-heading"><span className="root-title">{task.titlePreview}{task.titleTruncated ? "…" : ""}</span>
              <span className="root-meta"><span className="standalone-task-id">{id}</span> · 创建于 <time dateTime={task.createdAt}>{new Date(task.createdAt).toLocaleDateString("zh-CN")}</time></span></span>
            <span className="task-row-status"><span className={`root-status graph-status-${task.status}`}>{labels[task.status]}</span>{task.ready && <span className="task-ready">可开始</span>}</span>
            <svg className="standalone-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button></li>;
        })}</ul>
      )}
    </section>
  );
};
