import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { createProject, createTask, type Project, type Task } from './fixtures';

export type CapacityKind = 'chain' | 'merge' | 'shared';
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

export const seedCapacity = async (request: APIRequestContext, kind: CapacityKind): Promise<CapacityFixture> => {
  const project = await createProject(request, { name: `Capacity ${kind} ${randomUUID()}` });
  const root = await createTask(request, project.id, { title: `${kind} source root` });
  const tasks: Task[] = [root];
  if (kind === 'chain') {
    let previous = root;
    for (let index = 1; index < 1000; index++) {
      previous = await createTask(request, project.id, { title: `chain task ${index}`, dependsOn: [previous.id] });
      tasks.push(previous);
    }
    return { kind, project, root, tasks, edgeCount: 999 };
  }

  if (kind === 'merge') {
    let previous = await boundedMap(Array.from({ length: 99 }, (_, index) => index), (index) =>
      createTask(request, project.id, { title: `merge layer 1 task ${index}`, dependsOn: [root.id] }));
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
        createTask(request, project.id, { title: `merge layer ${layer} task ${index}`, dependsOn }));
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
    createTask(request, project.id, { title: `shared source ${index + 1}` }))];
  tasks.push(...roots.slice(1));
  const middle = await boundedMap(Array.from({ length: 499 }, (_, index) => index), (index) => {
    const otherCount = index < 10 ? 9 : 8;
    const dependsOn = [root.id, ...Array.from({ length: otherCount }, (_, offset) => roots[1 + (index * 8 + offset) % 499]!.id)];
    return createTask(request, project.id, { title: `shared middle ${index}`, dependsOn });
  });
  tasks.push(...middle);
  tasks.push(await createTask(request, project.id, { title: 'shared sink', dependsOn: middle.map((task) => task.id) }));
  return { kind, project, root, tasks, edgeCount: 5000 };
};

export const seedNodeLimit = async (request: APIRequestContext): Promise<Project> => {
  const project = await createProject(request, { name: `Capacity node limit ${randomUUID()}` });
  await boundedMap(Array.from({ length: 1001 }, (_, index) => index), (index) =>
    createTask(request, project.id, { title: `node limit task ${index}` }));
  return project;
};
