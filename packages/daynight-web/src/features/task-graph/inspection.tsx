import { createContext, useContext } from 'react';

export type TaskInspection = {
  readonly selectedTaskId: string | null;
  // Includes the selected task and every transitive prerequisite.
  readonly highlightedIds: ReadonlySet<string>;
};
export type TaskInspectionState = 'normal' | 'selected' | 'prerequisite' | 'unrelated';

export const TaskInspectionContext = createContext<TaskInspection | null>(null);

export const useTaskInspection = (): TaskInspection => {
  const inspection = useContext(TaskInspectionContext);
  if (inspection === null) throw new Error('Task inspection requires its graph provider.');
  return inspection;
};

export const useTaskInspectionState = (taskId: string): TaskInspectionState => {
  const { selectedTaskId, highlightedIds } = useTaskInspection();
  return selectedTaskId === null ? 'normal' : selectedTaskId === taskId ? 'selected'
    : highlightedIds.has(taskId) ? 'prerequisite' : 'unrelated';
};
