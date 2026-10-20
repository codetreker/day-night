import { describe, expect, it } from "vitest";
import { terminalText } from "../../src/platform/terminal.js";

describe("terminalText", () => {
  it("escapes terminal commands, control characters and line breaks as visible text", () => {
    expect(terminalText("name\u001b[2J\r\n\t\b\u007f\u0085\u009b31m\u2028\u2029")).toBe("name\\u001b[2J\\r\\n\\t\\u0008\\u007f\\u0085\\u009b31m\\u2028\\u2029");
  });
  it("preserves ordinary Unicode, emoji and literal backslashes", () => {
    const value = "Project 项目 🚀 👩🏽‍💻 e\u0301 \\path \uFEFF";
    expect(terminalText(value)).toBe(value);
  });
  it("preserves empty strings without inserting data", () => {
    expect(terminalText("")).toBe("");
  });
});
