export interface CliIo {
  readonly isTTY: boolean;
  writeOut(value: string): void;
  writeError(value: string): void;
}

export interface CommandResult {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly human: string;
}
