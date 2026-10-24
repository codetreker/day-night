import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { approveTask, attachmentPreviewRoot, getTask, getTaskGraph, listAttachments, readAttachmentText } from '../src/api/client';
import type { Attachment, TaskDetail } from '../src/api/types';
import { ProjectPage } from '../src/features/projects/ProjectPage';
import { createLocaleRender } from './helpers/renderWithLocale';
import { installGraphMeasurements } from './graph-measurements';
import { browsingProjects } from './mockups/browsing-fixture';

vi.mock('../src/api/client', async (original) => ({
  ...await original<typeof import('../src/api/client')>(),
  approveTask: vi.fn(), getTaskGraph: vi.fn(), getTask: vi.fn(), listAttachments: vi.fn(), readAttachmentText: vi.fn(),
}));

const render = createLocaleRender('zh-CN');
const graph = browsingProjects['complete-context'];
const rootId = graph.tasks.find((task) => task.titlePreview === '外部上下文 · 链内交付起点')!.id;
const selectedId = graph.tasks.find((task) => task.titlePreview === '外部前置 · 菱形合流')!.id;
const detailNode = graph.tasks.find((task) => task.titlePreview === '链内最终交付')!;
const detail: TaskDetail = {
  ...detailNode, version: 2n, projectId: graph.project.id, title: detailNode.titlePreview,
  description: '# Delivery notes\n\n[Read acceptance guide](docs/guide.md)', properties: { pullRequests: [] },
};
const attachment: Attachment = {
  path: 'docs/guide.md', contentType: 'text/markdown', sizeBytes: 64,
  createdAt: detailNode.createdAt, updatedAt: detailNode.updatedAt,
};
let root: HTMLDivElement;

beforeEach(() => {
  installGraphMeasurements();
  vi.mocked(approveTask).mockReset();
  root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  window.localStorage.setItem(`daynight:project-view:${graph.project.id}`, JSON.stringify({ expandedRootId: rootId }));
  vi.mocked(getTaskGraph).mockReset().mockResolvedValue(graph);
  vi.mocked(getTask).mockReset().mockResolvedValue(detail);
  vi.mocked(listAttachments).mockReset().mockResolvedValue({ items: [attachment], nextCursor: null });
  vi.mocked(readAttachmentText).mockReset().mockResolvedValue('# Attachment acceptance\n\n![Diagram](../images/diagram.svg)\n\nAll checks passed.');
});
afterEach(() => { cleanup(); root.remove(); });

const graphSnapshot = (container: HTMLElement) => ({
  hiddenUpstream: container.querySelector<HTMLElement>('.task-graph')!.dataset.hiddenUpstreamCount,
  nodes: [...container.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => ({
    id: node.dataset.id, position: node.style.transform, width: node.style.width, height: node.style.height,
    inspection: node.querySelector<HTMLElement>('.task-node')!.dataset.inspection,
  })),
  edges: [...container.querySelectorAll<SVGElement>('.task-dependency-edge')].map((edge) => ({
    id: edge.dataset.id, inspection: edge.dataset.inspection,
    shapes: [...edge.querySelectorAll<SVGElement>('.react-flow__edge-path,.task-dependency-paint-piece')].map((shape) => ({
      kind: shape.tagName, geometry: ['d', 'transform', 'x1', 'y1', 'x2', 'y2', 'marker-end'].map((name) => shape.getAttribute(name)),
      dashOffset: shape.style.strokeDashoffset,
    })),
  })),
  viewport: container.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform,
});

describe('graph inspection and detail reading integration', () => {
  it.each(['todo', 'proposed'] as const)('retains the selected dependency path while another %s task opens Markdown and its attachment in the same dialog', async (status) => {
    if (status === 'proposed') {
      vi.mocked(getTaskGraph).mockResolvedValue({ ...graph, tasks: graph.tasks.map((task) => task.id === detailNode.id ? { ...task, status, ready: false } : task),
        summary: { ...graph.summary, proposed: graph.summary.proposed + 1, todo: graph.summary.todo - 1, blocked: graph.summary.blocked - 1 } });
      vi.mocked(getTask).mockResolvedValue({ ...detail, status, ready: false, version: 1n });
    }
    const user = userEvent.setup();
    const view = render(<ProjectPage projectId={graph.project.id} />, { container: root });
    await waitFor(() => { expect(root.querySelectorAll('.react-flow__node')).toHaveLength(6); });
    await waitFor(() => { expect(root.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform).not.toBe('translate(0px,0px) scale(1)'); });
    const selected = root.querySelector<HTMLButtonElement>(`.react-flow__node[data-id="${selectedId}"] .task-node-body`)!;
    await user.click(selected);
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    const state = graphSnapshot(root);
    expect(state.nodes.filter((node) => node.inspection === 'selected').map((node) => node.id)).toEqual([selectedId]);
    expect(state.nodes.filter((node) => node.inspection === 'prerequisite').map((node) => node.id)).toEqual(
      [14, 15, 16].map((number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`),
    );
    expect(state.nodes.filter((node) => node.inspection === 'unrelated').map((node) => node.id)).toEqual([rootId, detailNode.id]);
    expect(state.edges.filter((edge) => edge.inspection === 'highlighted')).toHaveLength(4);
    const trigger = within(root.querySelector<HTMLElement>(`.react-flow__node[data-id="${detailNode.id}"]`)!).getByRole('button', { name: `${detail.title}，详情` });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'Delivery notes' });
    expect(root).toHaveAttribute('inert');
    if (status === 'proposed') expect(within(dialog).getByRole('button', { name: '批准任务' })).toBeEnabled();
    else expect(within(dialog).queryByRole('button', { name: '批准任务' })).toBeNull();
    expect(graphSnapshot(root)).toEqual(state);
    const link = within(dialog).getByRole('link', { name: 'Read acceptance guide' });
    expect(link).toHaveAttribute('href', `${attachmentPreviewRoot(graph.project.id, detailNode.id)}docs/guide.md`);
    await user.click(link);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).getByRole('tab', { name: '附件' })).toHaveAttribute('aria-selected', 'true');
    const preview = within(dialog).getByRole('group', { name: '附件预览' });
    expect(preview).toHaveFocus();
    await within(preview).findByRole('heading', { name: 'Attachment acceptance' });
    expect(within(preview).getByRole('img', { name: 'Diagram' })).toHaveAttribute('src', `${attachmentPreviewRoot(graph.project.id, detailNode.id)}images/diagram.svg`);
    expect(listAttachments).toHaveBeenCalledExactlyOnceWith(graph.project.id, detailNode.id, { limit: 100 }, expect.any(AbortSignal));
    expect(readAttachmentText).toHaveBeenCalledExactlyOnceWith(graph.project.id, detailNode.id, attachment.path, expect.any(AbortSignal));
    expect(graphSnapshot(root)).toEqual(state);
    await user.click(within(dialog).getByRole('button', { name: '关闭任务详情' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(root).not.toHaveAttribute('inert');
    expect(trigger).toHaveFocus();
    expect(graphSnapshot(view.container)).toEqual(state);
    expect(approveTask).not.toHaveBeenCalled();
    expect(getTaskGraph).toHaveBeenCalledTimes(1);
    expect(getTask).toHaveBeenCalledExactlyOnceWith(graph.project.id, detailNode.id, expect.any(AbortSignal));
  });
});
