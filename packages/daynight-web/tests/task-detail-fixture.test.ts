import { describe, expect, it } from 'vitest';
import { parseApiJson } from '../src/api/json';
import type { TaskDetail, TaskStatus } from '../src/api/types';
import { createTaskDetailFixture, detailProjectId, detailTaskId } from './mockups/task-detail-fixture';

describe('full-detail production component fixture', () => {
  it('models current status writes, exact-version no-ops, execution timing and dependent readiness', async () => {
    const fixture = createTaskDetailFixture();
    const url = `/api/v1/projects/${detailProjectId}/tasks/${detailTaskId}`;
    const read = async (): Promise<TaskDetail> => parseApiJson(await (await window.fetch(url)).text()) as TaskDetail;
    const set = async (status: TaskStatus, version: bigint): Promise<TaskDetail> => {
      const response = await window.fetch(`${url}/status`, { method: 'PUT', body: `{"status":"${status}","version":${version}}` });
      expect(response.status).toBe(200);
      return parseApiJson(await response.text()) as TaskDetail;
    };
    try {
      const initial = await read();
      expect(initial.status).toBe('todo');
      expect(await set('todo', initial.version)).toEqual(initial);
      const active = await set('in_progress', initial.version);
      expect(active.version).toBe(initial.version + 1n);
      expect(active.startedAt).not.toBeNull();
      expect(active.completedAt).toBeNull();
      expect(fixture.snapshot().graph.summary.inProgress).toBe(1);
      const completed = await set('done', active.version);
      expect(completed.startedAt).toBe(active.startedAt);
      expect(completed.completedAt).not.toBeNull();
      const successor = fixture.snapshot().graph.tasks.find((task) => task.dependsOn.includes(detailTaskId))!;
      expect(successor.ready).toBe(true);
      const successorUrl = `/api/v1/projects/${detailProjectId}/tasks/${successor.id}/status`;
      const startedSuccessor = await window.fetch(successorUrl, { method: 'PUT', body: '{"status":"in_progress","version":1}' });
      expect(startedSuccessor.status).toBe(200);
      const blockedReopen = await window.fetch(`${url}/status`, { method: 'PUT', body: `{"status":"in_progress","version":${completed.version}}` });
      expect(blockedReopen.status).toBe(409);
      const resetSuccessor = await window.fetch(successorUrl, { method: 'PUT', body: '{"status":"todo","version":2}' });
      expect(resetSuccessor.status).toBe(200);
      const reset = await set('todo', completed.version);
      expect(reset.startedAt).toBeNull();
      expect(reset.completedAt).toBeNull();
      expect(fixture.snapshot().graph.tasks.find((task) => task.dependsOn.includes(detailTaskId))!.ready).toBe(false);
      const stale = await window.fetch(`${url}/status`, { method: 'PUT', body: '{"status":"done","version":1}' });
      expect(stale.status).toBe(409);
    } finally { fixture.dispose(); }
  });
});
