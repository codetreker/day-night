import type { GraphTask, TaskDetail } from "../../api/types";

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((id) => right.includes(id));

export const isTaskStale = (snapshotNode: GraphTask | undefined, detail: TaskDetail): boolean => {
  if (snapshotNode === undefined) return true;
  const title = Array.from(detail.title);
  return snapshotNode.id !== detail.id || snapshotNode.updatedAt !== detail.updatedAt || snapshotNode.status !== detail.status ||
    snapshotNode.ready !== detail.ready || !sameIds(snapshotNode.dependsOn, detail.dependsOn) ||
    !sameIds(snapshotNode.blockedBy, detail.blockedBy) || snapshotNode.titlePreview !== title.slice(0, 160).join("") ||
    snapshotNode.titleTruncated !== (title.length > 160);
};

export const taskDescriptor = (task: GraphTask | undefined): string => task === undefined ? "" : JSON.stringify([
  task.id, task.updatedAt, task.status, task.ready, [...task.dependsOn].sort(), [...task.blockedBy].sort(), task.titlePreview, task.titleTruncated,
]);
