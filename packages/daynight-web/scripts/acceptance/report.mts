type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid Playwright report object.');
  return value as ObjectValue;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('Invalid Playwright report array.');
  return value;
};

export type Scenario = { name: string; title: string; durationMs: number; screenshots: string[] };

export const readReport = (value: unknown, required: readonly string[]): Scenario[] => {
  const report = object(value);
  if (array(report.errors).length !== 0) throw new Error('Playwright reported global errors.');
  const scenarios: Scenario[] = [];
  const visit = (raw: unknown): void => {
    const suite = object(raw);
    for (const rawSpec of array(suite.specs)) {
      const spec = object(rawSpec);
      if (spec.ok !== true || typeof spec.title !== 'string') throw new Error('Playwright spec did not pass.');
      const tests = array(spec.tests);
      if (tests.length !== 1) throw new Error('Expected exactly one project result per selected spec.');
      const test = object(tests[0]);
      if (test.expectedStatus !== 'passed' || test.status !== 'expected') throw new Error('Playwright test was skipped, flaky, or failed.');
      const results = array(test.results);
      if (results.length !== 1) throw new Error('Retries are forbidden in acceptance results.');
      const result = object(results[0]);
      if (result.status !== 'passed' || result.retry !== 0 || array(result.errors).length !== 0
        || typeof result.duration !== 'number' || !Number.isFinite(result.duration) || result.duration < 0) {
        throw new Error('Playwright result did not pass on its first attempt.');
      }
      const annotations = array(test.annotations).map(object).filter((annotation) => annotation.type === 'scenario');
      if (annotations.length !== 1 || typeof annotations[0]!.description !== 'string' || !/^[a-z][a-z0-9-]+$/.test(annotations[0]!.description)) {
        throw new Error('Each acceptance spec requires one stable scenario annotation.');
      }
      const screenshots = array(result.attachments).map(object)
        .filter((attachment) => attachment.contentType === 'image/png' && typeof attachment.path === 'string')
        .map((attachment) => attachment.path as string);
      if (screenshots.length === 0) throw new Error('Acceptance scenario is missing its screenshot attachment.');
      scenarios.push({ name: annotations[0]!.description, title: spec.title, durationMs: result.duration, screenshots });
    }
    for (const child of suite.suites === undefined ? [] : array(suite.suites)) visit(child);
  };
  for (const suite of array(report.suites)) visit(suite);
  if (scenarios.length === 0) throw new Error('No acceptance scenarios ran.');
  const names = new Set(scenarios.map((scenario) => scenario.name));
  if (names.size !== scenarios.length) throw new Error('Duplicate acceptance scenario names.');
  for (const name of required) if (!names.has(name)) throw new Error(`Required acceptance scenario missing: ${name}`);
  const stats = object(report.stats);
  if (stats.unexpected !== 0 || stats.flaky !== 0 || stats.skipped !== 0 || stats.expected !== scenarios.length) {
    throw new Error('Playwright summary disagrees with successful scenarios.');
  }
  return scenarios;
};
