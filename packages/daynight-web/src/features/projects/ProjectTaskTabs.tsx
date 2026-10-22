import type { KeyboardEvent } from "react";
import type { TaskView } from "./useProjectViewPreferences";

const views = ["standalone", "chains"] as const;
const labels = { standalone: "独立任务", chains: "任务链" };

type ProjectTaskTabsProps = {
  readonly activeView: TaskView;
  readonly standaloneCount: number;
  readonly chainCount: number;
  readonly onViewChange: (view: TaskView) => void;
};

export const ProjectTaskTabs = ({ activeView, standaloneCount, chainCount, onViewChange }: ProjectTaskTabsProps) => {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, view: TaskView) => {
    const position = views.indexOf(view);
    const target = event.key === "ArrowRight" ? views[(position + 1) % views.length]
      : event.key === "ArrowLeft" ? views[(position + views.length - 1) % views.length]
        : event.key === "Home" ? views[0] : event.key === "End" ? views[views.length - 1] : undefined;
    if (target === undefined) return;
    event.preventDefault();
    onViewChange(target);
    document.getElementById(`project-task-tab-${target}`)!.focus({ preventScroll: true });
  };
  return <div className="project-task-tabs" role="tablist" aria-label="项目任务视图">{views.map((view) => (
    <button className="project-task-tab" type="button" role="tab" id={`project-task-tab-${view}`} key={view}
      aria-label={labels[view]} aria-selected={activeView === view} aria-controls={`project-task-panel-${view}`} tabIndex={activeView === view ? 0 : -1}
      onClick={() => { onViewChange(view); }} onKeyDown={(event) => { onKeyDown(event, view); }}>
      {labels[view]}<span className="graph-count-pill" aria-hidden="true">{view === "standalone" ? standaloneCount : chainCount}</span>
    </button>
  ))}</div>;
};
