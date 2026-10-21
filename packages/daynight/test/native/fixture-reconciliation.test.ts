import { expect, it } from "vitest";
import { stringifyApiJson } from "../../src/api/json.js";
import type { Task } from "../../src/api/types.js";
import { inventoryObservesUniqueTask } from "./fixture-reconciliation.js";

const expected: Task = {
  id: "11111111-1111-4111-8111-111111111111", projectId: "22222222-2222-4222-8222-222222222222",
  title: "Document rounding policy", description: "Document decimal rounding behavior and verify representative examples.",
  status: "todo", version: 9_007_199_254_740_993n,
  properties: { pullRequests: [{ url: "https://example.test/pull/1", title: "Document rounding" }] },
  dependsOn: ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"],
  blockedBy: ["33333333-3333-4333-8333-333333333333"], ready: false,
  createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z",
};
const observes = (tasks: readonly Task[]): boolean => inventoryObservesUniqueTask(stringifyApiJson(tasks), expected);

it("accepts a complete uniquely matching observed resource without requiring a separate show", () => {
  expect(observes([{ ...expected, dependsOn: [...expected.dependsOn].reverse() }])).toBe(true);
  expect(observes([{ ...expected, id: "55555555-5555-4555-8555-555555555555", title: "Another work record" }, expected])).toBe(true);
});

it("rejects missing and ambiguous candidates even when the expected ID is present", () => {
  expect(observes([])).toBe(false);
  expect(observes([expected, { ...expected, id: "55555555-5555-4555-8555-555555555555" }])).toBe(false);
  expect(observes([{ ...expected, id: "55555555-5555-4555-8555-555555555555" }])).toBe(false);
});

it("requires the complete description, dependency set, and PR properties", () => {
  expect(observes([{ ...expected, description: "Same title, different intended work." }])).toBe(false);
  expect(observes([{ ...expected, dependsOn: [expected.dependsOn[0]!] }])).toBe(false);
  expect(observes([{ ...expected, properties: { pullRequests: [] } }])).toBe(false);
  expect(observes([{ ...expected, properties: { pullRequests: [{ url: "https://example.test/pull/1", title: "Another PR title" }] } }])).toBe(false);
});

it("rejects another project, incomplete summaries, and a noninventory response", () => {
  expect(() => observes([{ ...expected, projectId: "66666666-6666-4666-8666-666666666666" }])).toThrow("invalid response");
  expect(() => inventoryObservesUniqueTask(JSON.stringify([{ id: expected.id, title: expected.title, version: 1 }]), expected)).toThrow("invalid response");
  expect(inventoryObservesUniqueTask(stringifyApiJson(expected), expected)).toBe(false);
});
