import { randomUUID } from 'node:crypto';
import type { AuthenticatedAPI } from './authentication';
import { createProject, createApprovedTask, updateTask, type Project, type Task } from './fixtures';

export type CapacityKind = 'chain' | 'merge' | 'shared' | 'external';
export type CapacityFixture = {
  kind: CapacityKind;
  project: Project;
  root: Task;
  tasks: readonly Task[];
  edgeCount: number;
  additionalEdge?: { task: Task; predecessorId: string };
};

export const boundedMap = async <Input, Output>(items: readonly Input[], operation: (item: Input, index: number) => Promise<Output>): Promise<Output[]> => {
  const result = new Array<Output>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(6, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      result[index] = await operation(items[index]!, index);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failures = settled.filter((value): value is PromiseRejectedResult => value.status === 'rejected');
  if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), 'Capacity fixture API requests failed.');
  return result;
};

export const seedCapacity = async (request: AuthenticatedAPI, kind: CapacityKind): Promise<CapacityFixture> => {
  const project = await createProject(request, { name: `Capacity ${kind} ${randomUUID()}` });
  const root = await createApprovedTask(request, project.id, { title: `${kind} source root` });
  const tasks: Task[] = [root];
  if (kind === 'external') {
    let previous = await boundedMap(Array.from({ length: 99 }, (_, index) => index), (index) =>
      createApprovedTask(request, project.id, { title: `external source ${index}` }));
    tasks.push(...previous);
    let additional = 397;
    for (let layer = 1; layer <= 9; layer++) {
      const inputs = Array.from({ length: 99 }, (_, index) => {
        const count = additional > 0 ? 6 : 5;
        if (additional > 0) additional--;
        return { index, dependsOn: Array.from({ length: count }, (_, offset) => previous[(index * 5 + offset) % previous.length]!.id) };
      });
      previous = await boundedMap(inputs, ({ index, dependsOn }) =>
        createApprovedTask(request, project.id, { title: `external layer ${layer} task ${index}`, dependsOn }));
      tasks.push(...previous);
    }
    const tails = await boundedMap(Array.from({ length: 8 }, (_, index) => index), (index) =>
      createApprovedTask(request, project.id, { title: `external final prerequisite ${index}`, dependsOn: Array.from({ length: 5 }, (_, offset) => previous[index * 5 + offset]!.id) }));
    tasks.push(...tails);
    tasks.push(await createApprovedTask(request, project.id, { title: 'external chain sink', groupId: root.groupId, dependsOn: [root.id, ...previous.map((task) => task.id), ...tails.map((task) => task.id)] }));
    return { kind, project, root, tasks, edgeCount: 5000 };
  }

  if (kind === 'chain') {
    tasks.push(...await boundedMap(Array.from({ length: 999 }, (_, index) => index + 1), (index) =>
      createApprovedTask(request, project.id, { groupId: root.groupId, title: `chain task ${index}` })));
    // We attach the chain from its sink so each existing predecessor is still
    // independent when cycle validation traverses it. The final graph is built
    // entirely through the same public write API as the other capacity graphs.
    for (let index = tasks.length - 1; index > 0; index--) {
      const task = tasks[index]!;
      tasks[index] = await updateTask(request, project.id, task.id, { version: task.version, dependsOn: [tasks[index - 1]!.id] });
    }
    return { kind, project, root, tasks, edgeCount: 999 };
  }

  if (kind === 'merge') {
    let previous = await boundedMap(Array.from({ length: 99 }, (_, index) => index), (index) =>
      createApprovedTask(request, project.id, { groupId: root.groupId, title: `merge layer 1 task ${index}`, dependsOn: [root.id] }));
    tasks.push(...previous);
    let additional = 401;
    let extraEdge: CapacityFixture['additionalEdge'];
    for (let layer = 2; layer <= 10; layer++) {
      const layerInputs = Array.from({ length: 100 }, (_, index) => {
        const count = additional > 0 ? 6 : 5;
        if (additional > 0) additional--;
        return { index, dependsOn: Array.from({ length: count }, (_, offset) => previous[(index * 5 + offset) % previous.length]!.id) };
      });
      const current = await boundedMap(layerInputs, ({ index, dependsOn }) =>
        createApprovedTask(request, project.id, { groupId: root.groupId, title: `merge layer ${layer} task ${index}`, dependsOn }));
      if (layer === 10) {
        const task = current[current.length - 1]!;
        const predecessorId = previous.find((candidate) => !task.dependsOn.includes(candidate.id))!.id;
        extraEdge = { task, predecessorId };
      }
      tasks.push(...current);
      previous = current;
    }
    return { kind, project, root, tasks, edgeCount: 5000, additionalEdge: extraEdge! };
  }

  const roots = [root, ...await boundedMap(Array.from({ length: 499 }, (_, index) => index), (index) =>
    createApprovedTask(request, project.id, { title: `shared source ${index + 1}` }))];
  tasks.push(...roots.slice(1));
  const middle = await boundedMap(Array.from({ length: 499 }, (_, index) => index), (index) => {
    const otherCount = index < 10 ? 9 : 8;
    const dependsOn = [root.id, ...Array.from({ length: otherCount }, (_, offset) => roots[1 + (index * 8 + offset) % 499]!.id)];
    return createApprovedTask(request, project.id, { groupId: root.groupId, title: `shared middle ${index}`, dependsOn });
  });
  tasks.push(...middle);
  tasks.push(await createApprovedTask(request, project.id, { title: 'shared sink', groupId: root.groupId, dependsOn: middle.map((task) => task.id) }));
  return { kind, project, root, tasks, edgeCount: 5000 };
};

export const seedNodeLimit = async (request: AuthenticatedAPI): Promise<Project> => {
  const project = await createProject(request, { name: `Capacity node limit ${randomUUID()}` });
  await boundedMap(Array.from({ length: 1001 }, (_, index) => index), (index) =>
    createApprovedTask(request, project.id, { title: `node limit task ${index}` }));
  return project;
};
