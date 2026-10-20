import assert from 'node:assert/strict';
import test from 'node:test';
import { readReport } from './report.mts';

const report = () => ({ errors: [], suites: [{ specs: [], suites: [{ specs: [{ title: 'sample', ok: true, tests: [{
  expectedStatus: 'passed', status: 'expected', annotations: [{ type: 'scenario', description: 'sample-flow' }],
  results: [{ status: 'passed', retry: 0, errors: [], duration: 12, attachments: [{ contentType: 'image/png', path: '/owned/sample.png' }] }],
}] }], suites: [] }] }], stats: { expected: 1, skipped: 0, flaky: 0, unexpected: 0 } });
test('recursively verifies a first-attempt scenario', () => assert.deepEqual(readReport(report(), ['sample-flow']), [
  { name: 'sample-flow', title: 'sample', durationMs: 12, screenshots: ['/owned/sample.png'] },
]));
test('rejects missing required scenarios', () => assert.throws(() => readReport(report(), ['missing'])));
test('rejects empty or malformed reports', () => {
  for (const value of [null, {}, { errors: [], suites: [], stats: {} }]) assert.throws(() => readReport(value, []));
});
test('rejects retries and unexpected statuses', () => {
  for (const mutate of [
    (value: ReturnType<typeof report>) => { value.errors.push('error' as never); },
    (value: ReturnType<typeof report>) => { value.stats.skipped = 1; },
    (value: ReturnType<typeof report>) => { value.suites[0]!.suites[0]!.specs[0]!.tests[0]!.status = 'flaky'; },
    (value: ReturnType<typeof report>) => { value.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1; },
    (value: ReturnType<typeof report>) => { value.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results.push({ status: 'passed', retry: 1, errors: [], duration: 12, attachments: [] }); },
    (value: ReturnType<typeof report>) => { value.suites[0]!.suites[0]!.specs[0]!.tests[0]!.annotations = []; },
    (value: ReturnType<typeof report>) => { value.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments = []; },
  ]) {
    const value = report(); mutate(value); assert.throws(() => readReport(value, []));
  }
});
