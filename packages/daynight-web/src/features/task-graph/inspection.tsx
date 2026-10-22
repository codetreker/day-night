import { createContext, useContext } from 'react';

export type InspectionState = 'normal' | 'selected' | 'prerequisite' | 'unrelated';

export type TaskInspection = {
  readonly selectedTaskId: string | null;
  readonly highlighted: ReadonlySet<string> | null;
};

export const TaskInspectionContext = createContext<TaskInspection | null>(null);

export const useTaskInspection = (): TaskInspection => {
  const inspection = useContext(TaskInspectionContext);
  if (inspection === null) throw new Error('Task inspection requires its graph provider.');
  return inspection;
};

export const useTaskInspectionState = (taskId: string): InspectionState => {
  const inspection = useTaskInspection();
  return inspection.selectedTaskId === null ? 'normal' : inspection.selectedTaskId === taskId ? 'selected'
    : inspection.highlighted!.has(taskId) ? 'prerequisite' : 'unrelated';
};
