import { describe, expect, it } from "vitest";
import { renderBashCompletion } from "../../../src/commands/completion/bash.js";
import type { CommandDefinition } from "../../../src/cli/schema.js";

describe("Bash completion rendering", () => {
  it("renders the supplied command tree, aliases, option identity, and argument choices", () => {
    const definition: CommandDefinition = {
      name: "tool",
      description: "Example command",
      commands: [{
        name: "inspect",
        aliases: ["show"],
        description: "Inspect a resource",
        options: [
          { names: ["-d", "--directory"], description: "Directory", value: { name: "path", kind: "directory" } },
          { names: ["--help"], description: "Help", action: "help" },
        ],
        arguments: [{ name: "format", description: "Output format", choices: ["json", "text"] }],
      }],
    };

    const script = renderBashCompletion(definition);
    expect(script).toContain("complete -F _tool_completion 'tool'");
    expect(script).toContain("dn_children=('inspect' 'show')");
    expect(script).toContain("dn_child_nodes=('1' '1')");
    expect(script).toContain("dn_options=('-d' '--directory' '--help')");
    expect(script).toContain("dn_option_ids=('0' '0' '1')");
    expect(script).toContain("dn_option_values=('directory' 'directory' '')");
    expect(script).toContain("dn_option_actions=('' '' 'help')");
    expect(script).toContain("dn_choices=('json' 'text')");
    expect(script).not.toContain("review");
  });

  it("quotes every command, alias, option, and fixed candidate as shell data", () => {
    const value = "a'b $HOME `uname` $(touch unsafe):中文";
    const quoted = "'a'\\''b $HOME `uname` $(touch unsafe):中文'";
    const script = renderBashCompletion({
      name: "tool",
      description: "",
      commands: [{
        name: value,
        aliases: ["another'alias"],
        description: "A description need not become executable shell code",
        options: [{ names: [value], description: "" }],
        arguments: [{ name: "choice", description: "", choices: [value] }],
      }],
    });

    expect(script).toContain(`dn_children=(${quoted} 'another'\\''alias')`);
    expect(script).toContain(`dn_options=(${quoted})`);
    expect(script).toContain(`dn_choices=(${quoted})`);
    expect(script).not.toContain("A description need not become executable shell code");
  });

  it("guards the Bash baseline before defining or registering completion", () => {
    const script = renderBashCompletion({ name: "tool", description: "" });
    const guard = script.indexOf("BASH_VERSINFO[1] < 2");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(script.indexOf("_tool_completion_words()"));
    expect(script).toContain("return 1 2>/dev/null || exit 1");
    expect(script).not.toContain("COMP_WORDBREAKS=");
    expect(script).not.toMatch(/\beval\b/);
  });

  it("preserves replacement metacharacters and generator markers in metadata", () => {
    const script = renderBashCompletion({
      name: "tool",
      description: "",
      arguments: [{ name: "choice", description: "", choices: ["$&", "$'", "@COMMAND@", "@PREFIX@", "@{"] }],
    });
    expect(script).toContain("dn_choices=('$&' '$'\\''' '@COMMAND@' '@PREFIX@' '@{')");
    expect(script).toContain("complete -F _tool_completion 'tool'");
  });
});
