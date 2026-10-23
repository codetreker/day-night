export type ExecutionMessages = {
  readonly possiblyStuck: string;
  readonly description: (args: {
    readonly duration: string;
    readonly startedAt: string;
    readonly completedAt: string | null;
    readonly warningMinutes: number;
    readonly overdue: boolean;
  }) => string;
};
