import { UsageError } from "./context.js";

export type CommandOption = {
  names: readonly string[];
  description: string;
  value?: { name: string; kind: "directory" };
  action?: "help" | "version";
};

export type CommandArgument = {
  name: string;
  description: string;
  choices?: readonly string[];
};

export type CommandDefinition = {
  name: string;
  description: string;
  aliases?: readonly string[];
  commands?: readonly CommandDefinition[];
  options?: readonly CommandOption[];
  arguments?: readonly CommandArgument[];
  details?: string;
};

type CommandLocation = { command: CommandDefinition; path: readonly string[] };

export type CommandSelection = CommandLocation & (
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "selected"; remaining: readonly string[] }
);

export type ParsedCommand = CommandLocation & (
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "run"; values: readonly string[]; options: ReadonlyMap<string, string | true> }
);

const matchesCommand = (command: CommandDefinition, name: string): boolean =>
  command.name === name || command.aliases?.includes(name) === true;

const informationAction = (command: CommandDefinition, args: readonly string[]): "help" | "version" | undefined =>
  args.length === 1 ? command.options?.find((option) => option.names.includes(args[0]!))?.action : undefined;

export const selectCommand = (
  definition: CommandDefinition,
  args: readonly string[],
  path: readonly string[] = [definition.name],
  helpCommand = `${path.join(" ")} --help`,
): CommandSelection => {
  const action = informationAction(definition, args);
  if (action !== undefined) return { kind: action, command: definition, path };
  if (args.length === 0) return { kind: "help", command: definition, path };
  const command = definition.commands?.find((candidate) => matchesCommand(candidate, args[0]!));
  if (command === undefined) throw new UsageError(`Unknown command ${JSON.stringify(args[0])}.`, helpCommand);
  return { kind: "selected", command, path: [...path, command.name], remaining: args.slice(1) };
};

export const parseCommand = (
  definition: CommandDefinition,
  args: readonly string[],
  path: readonly string[] = [definition.name],
  helpCommand = `${path.join(" ")} --help`,
): ParsedCommand => {
  if (definition.commands !== undefined) {
    const selection = selectCommand(definition, args, path, helpCommand);
    if (selection.kind !== "selected") return selection;
    return parseCommand(selection.command, selection.remaining, selection.path, helpCommand);
  }
  const action = informationAction(definition, args);
  if (action !== undefined) return { kind: action, command: definition, path };
  const values: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument.startsWith("-")) {
      const option = definition.options?.find((candidate) => candidate.names.includes(argument));
      if (option === undefined || option.action !== undefined) {
        throw new UsageError(`Unknown ${definition.name} option ${JSON.stringify(argument)}.`, helpCommand);
      }
      const name = option.names[0]!;
      if (options.has(name)) throw new UsageError(`Specify ${name} only once.`, helpCommand);
      if (option.value === undefined) {
        options.set(name, true);
      } else {
        const value = args[++index];
        if (value === undefined || value === "" || value.startsWith("-")) {
          throw new UsageError(`${name} requires a ${option.value.name} value.`, helpCommand);
        }
        options.set(name, value);
      }
      continue;
    }
    const positional = definition.arguments?.[values.length];
    if (positional === undefined) throw new UsageError(`Unexpected ${definition.name} argument ${JSON.stringify(argument)}.`, helpCommand);
    if (argument.trim() === "") throw new UsageError(`${definition.name} requires a ${positional.name} value.`, helpCommand);
    if (positional.choices !== undefined && !positional.choices.includes(argument)) {
      throw new UsageError(`Unknown ${positional.name} ${JSON.stringify(argument)}. Expected ${positional.choices.join(" or ")}.`, helpCommand);
    }
    values.push(argument);
  }
  const missing = definition.arguments?.[values.length];
  if (missing !== undefined) throw new UsageError(`${definition.name} requires a ${missing.name} value.`, helpCommand);
  return { kind: "run", command: definition, path, values, options };
};

const optionLabel = (option: CommandOption): string =>
  `${option.names.join(", ")}${option.value === undefined ? "" : ` <${option.value.name}>`}`;

const optionUsage = (option: CommandOption): string =>
  `${option.names[0]}${option.value === undefined ? "" : ` <${option.value.name}>`}`;

const renderRows = (rows: readonly (readonly [string, string])[]): string => {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return rows.map(([label, description]) => `  ${label.padEnd(width)}${description}`).join("\n");
};

export const renderCommandHelp = (
  definition: CommandDefinition,
  path: readonly string[] = [definition.name],
): string => {
  const suffix = definition.commands !== undefined ? " <command>" : [
    ...(definition.arguments ?? []).map(({ name }) => ` <${name}>`),
    ...(definition.options ?? []).filter(({ action }) => action === undefined).map((option) => ` [${optionUsage(option)}]`),
  ].join("");
  const paths = [path, ...(definition.aliases ?? []).map((alias) => [...path.slice(0, -1), alias])];
  const sections = [paths.map((parts, index) => `${index === 0 ? "Usage: " : "       "}${parts.join(" ")}${suffix}`).join("\n")];
  if (definition.commands === undefined) sections.push(definition.description);
  if (definition.commands !== undefined) sections.push(`Commands:\n${renderRows(definition.commands.map((command) => [[command.name, ...(command.aliases ?? [])].join(", "), command.description]))}`);
  if (definition.arguments !== undefined) sections.push(`Arguments:\n${renderRows(definition.arguments.map(({ name, description }) => [`<${name}>`, description]))}`);
  if (definition.options !== undefined) sections.push(`Options:\n${renderRows(definition.options.map((option) => [optionLabel(option), option.description]))}`);
  if (definition.details !== undefined) sections.push(definition.details);
  return `${sections.join("\n\n")}\n`;
};
