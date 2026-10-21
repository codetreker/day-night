export type NativeHostName = "codex" | "copilot" | "claude";

export type NativeHostEvent = {
  readonly kind: "skill" | "command" | "message";
  readonly text: string;
  readonly exitCode?: number;
  readonly observedFile?: { readonly path: string; readonly sha256: string };
};

export type NativeHostRequest = {
  readonly workingDirectory: string;
  readonly fixtureDirectory: string;
  readonly homeDirectory: string;
  readonly stateDirectory: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly prompt: string;
  readonly skillEntrypoints: readonly string[];
  readonly expectedSkillContents: string;
  readonly timeoutMs: number;
};

export type NativeHostResult = {
  readonly host: NativeHostName;
  readonly version: string;
  readonly model?: string;
  readonly sandbox?: "workspace-write" | "danger-full-access";
  readonly runtime?: Readonly<Record<string, string | number | boolean>>;
  readonly events: readonly NativeHostEvent[];
  readonly usage?: Readonly<Record<string, number>>;
  readonly finalText: string;
};
