import { describe, expect, it } from "vitest";
import { renderBashCompletion } from "../../../src/commands/completion/bash.js";
import { commandTree } from "../../../src/cli/commands.js";
import type { CommandDefinition } from "../../../src/cli/schema.js";

describe("Bash completion rendering", () => {
  it("registers both installed command names with the same completion function", () => {
    expect(renderBashCompletion(commandTree)).toContain("complete -F _daynight_completion 'daynight' 'dn'\n");
  });

  it("treats the server token stdin option as a boolean without a secret value completion", () => {
    const script = renderBashCompletion(commandTree);
    expect(script).toContain("dn_options=('--server-url' '--server-token-stdin' '--review-repo' '--review-path' '-h' '--help')");
    expect(script).toContain("dn_option_values=('text' '' 'text' 'directory' '' '')");
  });

  it("registers all three attachment command levels and operation options", () => {
    const script = renderBashCompletion(commandTree);
    expect(script).toContain("'attachment'");
    expect(script).toContain("dn_children=('put' 'list' 'read' 'remove')");
    expect(script).toContain("dn_options=('--path' '--project' '-h' '--help')");
    expect(script).toContain("dn_options=('--tree' '--project' '--json' '-h' '--help')");
  });

  it("renders the supplied command tree, aliases, option identity, and argument choices", () => {
    const definition: CommandDefinition = {
      name: "tool",
      aliases: ["t"],
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
    expect(script).toContain("complete -F _tool_completion 'tool' 't'\n");
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
      aliases: [value],
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
    expect(script).toContain(`complete -F _tool_completion 'tool' ${quoted}\n`);
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

  it("consumes text values without file or option candidates", () => {
    const script = renderBashCompletion({
      name: "tool",
      description: "",
      options: [{ names: ["--name"], description: "Name", value: { name: "name", kind: "text" }, required: true }],
    });
    expect(script).toContain("dn_option_values=('text')");
    const noTextCandidates = script.indexOf('if [[ "$dn_pending" == text ]]; then');
    expect(noTextCandidates).toBeGreaterThan(0);
    expect(noTextCandidates).toBeLessThan(script.indexOf('if [[ "$dn_pending" == directory ]]'));
  });

  it("derives option termination from the command definition", () => {
    const script = renderBashCompletion({ name: "tool", description: "", allowOptionsTerminator: true, arguments: [{ name: "name", description: "Name" }] });
    expect(script).toContain("dn_allow_terminator=1");
    expect(script).toContain('if ((!dn_options_terminated && dn_allow_terminator)) && [[ "$dn_word" == -- ]]');
    expect(script).toContain("((dn_options_terminated)) && return 0");
    expect(renderBashCompletion({ name: "tool", description: "" })).toContain("dn_allow_terminator=0");
  });

  it("retains repeat and empty metadata and separates named static choices", () => {
    const script = renderBashCompletion({ name: "tool", description: "", options: [
      { names: ["--status"], description: "", value: { name: "status", kind: "text", choices: ["todo", "done"] } },
      { names: ["--depends-on"], description: "", value: { name: "task", kind: "text" }, repeatable: true },
      { names: ["--description"], description: "", value: { name: "description", kind: "text", allowEmpty: true } },
    ] });
    expect(script).toContain("dn_option_repeats=('0' '1' '0')");
    expect(script).toContain("dn_option_empty=('0' '0' '1')");
    expect(script).toContain("0) dn_value_choices=('todo' 'done')");
    expect(script).toContain('dn_current="${dn_current#*=}"');
    expect(script).toContain('dn_fragment="${COMP_WORDS[COMP_CWORD]}"');
    expect(script).not.toContain("COMP_WORDBREAKS=");
  });
});
