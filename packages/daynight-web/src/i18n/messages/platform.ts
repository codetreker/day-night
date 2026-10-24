import type { ExecutionPlatform } from "../../api/types";

export type PlatformMessages = {
  readonly title: string;
  readonly any: string;
  readonly names: Readonly<Record<ExecutionPlatform, string>>;
  readonly save: string;
  readonly help: string;
  readonly locked: string;
  readonly pending: string;
  readonly confirmed: string;
  readonly conflict: string;
  readonly unknown: string;
  readonly reconciled: string;
  readonly checking: string;
  readonly checkState: string;
  readonly checkFailed: string;
  readonly networkError: string;
  readonly protocolError: string;
  readonly versionConflict: string;
  readonly invalidTransition: string;
  readonly notFound: string;
  readonly refused: string;
  readonly requestFailed: string;
};
