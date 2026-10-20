import { describe, expect, it } from "vitest";
import { isNonemptyText, isText } from "../../src/platform/text.js";

describe("service text contract", () => {
  it.each(["", " \t\r\n", "\u0085", "\uFEFF", "\u0001\u007f\u009f", "项目 🚀 👩🏽‍💻 e\u0301"])("accepts well-formed text without NUL %j", (value) => {
    expect(isText(value)).toBe(true);
  });
  it.each([undefined, null, 0, false, {}, [], "\0", "name\0tail", "\uD800", "\uDC00", "name\uD800tail"])("rejects invalid text %j", (value) => {
    expect(isText(value)).toBe(false);
    expect(isNonemptyText(value)).toBe(false);
  });
  it.each(["", " ", "\t\r\n", "\u0085", "\u00A0\u2003\u2028\u2029"])("rejects Unicode White_Space-only names %j", (value) => {
    expect(isNonemptyText(value)).toBe(false);
  });
  it.each(["\uFEFF", "\uFEFF\u0085", "\u0001", "\u200B", " 名称 🚀 "])("preserves Go-valid nonempty names %j", (value) => {
    expect(isNonemptyText(value)).toBe(true);
  });
});
