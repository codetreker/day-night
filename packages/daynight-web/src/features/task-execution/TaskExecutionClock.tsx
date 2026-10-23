import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GraphSnapshot } from "../projects/useTaskGraph";
import { createTaskExecutionClock, executionKind, taskExecution, type ExecutionTask, type TaskExecution, type TaskExecutionClock } from "./clock";

const ClockContext = createContext<TaskExecutionClock | null>(null);
const inactiveSubscription = () => () => {};
const inactiveSnapshot = () => null;

type ClockProps = {
  readonly projectId: string;
  readonly snapshot: GraphSnapshot;
  readonly children: ReactNode;
};
const ClockScope = ({ projectId, snapshot, children }: ClockProps) => {
  if (snapshot.graph.project.id !== projectId) throw new Error("The task execution clock requires its project's graph snapshot.");
  const [clock] = useState(() => createTaskExecutionClock({
    observedAt: snapshot.observedAt, receivedMonotonic: snapshot.receivedMonotonic,
    warningMinutes: snapshot.graph.project.settings.executionWarningMinutes,
  }));
  useLayoutEffect(() => clock.mount(), [clock]);
  useLayoutEffect(() => { clock.update({
    observedAt: snapshot.observedAt, receivedMonotonic: snapshot.receivedMonotonic,
    warningMinutes: snapshot.graph.project.settings.executionWarningMinutes,
  }); }, [clock, snapshot.observedAt, snapshot.receivedMonotonic, snapshot.graph.project.settings.executionWarningMinutes]);
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
};

export const TaskExecutionClockProvider = (props: ClockProps) => <ClockScope key={props.projectId} {...props} />;

export const useTaskExecution = (task: ExecutionTask): TaskExecution | null => {
  const clock = useContext(ClockContext);
  const kind = executionKind(task);
  if (kind !== null && clock === null) throw new Error("A timed task requires TaskExecutionClockProvider.");
  const running = kind === "running";
  const completed = kind === "completed";
  const sample = useSyncExternalStore(running ? clock!.subscribeRunning : inactiveSubscription,
    running ? clock!.getSnapshot : inactiveSnapshot, running ? clock!.getSnapshot : inactiveSnapshot);
  const warning = useSyncExternalStore(completed ? clock!.subscribeSettings : inactiveSubscription,
    completed ? clock!.getWarningSnapshot : inactiveSnapshot, completed ? clock!.getWarningSnapshot : inactiveSnapshot);
  if (kind === null) return null;
  return taskExecution(task, running ? sample! : { ...clock!.getSnapshot(), warningMinutes: warning!.warningMinutes });
};
