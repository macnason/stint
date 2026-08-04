export interface CliIo {
  readonly isTTY: boolean;
  writeOut(value: string): void;
  writeError(value: string): void;
  /** Optional interactive input hook used by setup/add in TTY mode. */
  readonly prompt?: (message: string) => Promise<string>;
}

export interface CommandResult {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly human: string;
}
