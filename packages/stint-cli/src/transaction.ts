import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, relative, sep } from "node:path";

import { CliError } from "./diagnostics.js";
import {
  assertCurrentDestinationSafe,
  isMissing,
  prepareDestination,
  readFileNoFollow,
  recheckDestination,
  type SafeDestination,
} from "./project.js";

export type ConflictPolicy = "abort" | "overwrite" | "skip";
export type TransactionActionKind =
  | "create"
  | "overwrite"
  | "skip"
  | "unchanged";

export interface ProposedWrite {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly mode?: number;
  /** Existing bytes this mutation was derived from, for abort-mode compare-and-swap. */
  readonly expectedOriginalContent?: string | Uint8Array;
}

export interface TransactionAction {
  readonly path: string;
  readonly action: TransactionActionKind;
  readonly bytes: number;
  readonly destination: SafeDestination;
  readonly content: Buffer;
  readonly mode: number;
  readonly originalContent?: Buffer;
  readonly originalMode?: number;
}

export interface TransactionPlan {
  readonly projectRoot: string;
  readonly conflict: ConflictPolicy;
  readonly actions: readonly TransactionAction[];
}

export interface PlanTransactionOptions {
  readonly projectRoot: string;
  readonly conflict?: ConflictPolicy;
  readonly writes: readonly ProposedWrite[];
}

export interface ApplyTransactionOptions {
  /** Test/integration hook used to model cancellation or an interrupted write. */
  readonly beforeWrite?: (index: number, action: TransactionAction) => void;
  /** Test/integration hook used to model failure after a backup is created. */
  readonly beforeBackupWrite?: (
    index: number,
    action: TransactionAction,
  ) => void;
}

export function isConflictPolicy(value: string): value is ConflictPolicy {
  return value === "abort" || value === "overwrite" || value === "skip";
}

interface AppliedWrite {
  readonly action: TransactionAction;
  readonly backupPath?: string;
}

export function planTransaction({
  projectRoot,
  conflict = "abort",
  writes,
}: PlanTransactionOptions): TransactionPlan {
  if (!isConflictPolicy(conflict)) {
    throw new CliError("E_OPTION", "Conflict policy must be abort, skip, or overwrite.", {
      exitCode: 2,
    });
  }

  const canonicalRoot = realpathSync(projectRoot);
  const seen = new Set<string>();
  let actions = writes.map((write): TransactionAction => {
    const destination = prepareDestination(canonicalRoot, write.path);
    if (seen.has(destination.relativePath)) {
      throw new CliError("E_CONFLICT", "The write plan contains a duplicate destination.", {
        path: destination.relativePath,
      });
    }
    seen.add(destination.relativePath);
    const content = Buffer.from(write.content);
    const mode = write.mode ?? 0o644;

    try {
      const metadata = lstatSync(destination.absolutePath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new CliError("E_SECURITY", "Existing destinations must be regular files.", {
          path: destination.relativePath,
        });
      }
      const originalContent = readFileNoFollow(destination.absolutePath);
      if (originalContent.equals(content)) {
        return {
          path: destination.relativePath,
          action: "unchanged",
          bytes: content.byteLength,
          destination,
          content,
          mode,
          originalContent,
          originalMode: metadata.mode & 0o777,
        };
      }
      const expectedOriginalContent =
        write.expectedOriginalContent === undefined
          ? undefined
          : Buffer.from(write.expectedOriginalContent);
      if (
        conflict === "abort" &&
        (!expectedOriginalContent || !originalContent.equals(expectedOriginalContent))
      ) {
        throw new CliError("E_CONFLICT", "A generated file conflicts with existing content.", {
          path: destination.relativePath,
        });
      }
      return {
        path: destination.relativePath,
        action: conflict === "skip" ? "skip" : "overwrite",
        bytes: content.byteLength,
        destination,
        content,
        mode,
        originalContent,
        originalMode: metadata.mode & 0o777,
      };
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (!isMissing(error)) {
        throw new CliError("E_IO", "An existing destination could not be inspected.", {
          cause: error,
          path: destination.relativePath,
        });
      }
      return {
        path: destination.relativePath,
        action: "create",
        bytes: content.byteLength,
        destination,
        content,
        mode,
      };
    }
  });

  // Skip is transaction-wide: creating one missing companion file while
  // skipping another drifted file would leave generated outputs inconsistent.
  if (conflict === "skip" && actions.some((action) => action.action === "skip")) {
    actions = actions.map((action) =>
      action.action === "unchanged" ? action : { ...action, action: "skip" },
    );
  }

  return { projectRoot: canonicalRoot, conflict, actions };
}

export function applyTransaction(
  plan: TransactionPlan,
  options: ApplyTransactionOptions = {},
): TransactionPlan {
  // Revalidate every destination before the first mutation so planning and apply
  // cannot be separated by an unnoticed ancestor replacement. The leaf is
  // checked separately against its planned bytes so ordinary races are
  // reported as conflicts while symlinks remain security errors.
  for (const action of plan.actions) {
    if (action.action === "unchanged" || action.action === "skip") {
      recheckDestination(plan.projectRoot, action.destination);
      continue;
    }
    recheckDestination(plan.projectRoot, action.destination, { ignoreLeaf: true });
    assertCurrentDestinationSafe(
      plan.projectRoot,
      action.destination.absolutePath,
      action.path,
    );
    assertTargetStillMatchesPlan(action);
  }

  const applied: AppliedWrite[] = [];
  const createdDirectories: string[] = [];
  const privateFiles = new Set<string>();

  try {
    plan.actions.forEach((action, index) => {
      if (action.action === "unchanged" || action.action === "skip") return;
      options.beforeWrite?.(index, action);
      ensureParents(plan.projectRoot, action.destination, createdDirectories);
      assertCurrentDestinationSafe(
        plan.projectRoot,
        action.destination.absolutePath,
        action.path,
      );
      assertTargetStillMatchesPlan(action);

      let backupPath: string | undefined;
      if (action.originalContent) {
        backupPath = privateSibling(action.destination.absolutePath, "backup");
        writePrivateFile(
          backupPath,
          action.originalContent,
          () => {
            privateFiles.add(backupPath!);
          },
          () => options.beforeBackupWrite?.(index, action),
        );
      }

      atomicReplace(
        plan.projectRoot,
        action.destination,
        action.content,
        action.originalMode ?? action.mode,
        privateFiles,
        () => assertTargetStillMatchesPlan(action),
      );
      applied.push({ action, backupPath });
    });

    for (const file of privateFiles) safeUnlink(file);
    return plan;
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    for (const appliedWrite of [...applied].reverse()) {
      try {
        rollbackWrite(plan.projectRoot, appliedWrite, privateFiles);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    for (const file of privateFiles) safeUnlink(file);
    for (const directory of [...createdDirectories].reverse()) {
      try {
        rmdirSync(directory);
      } catch {
        // A non-empty directory either predates this transaction or contains
        // state we do not own, so it must not be removed.
      }
    }
    if (rollbackFailures.length > 0) {
      throw new CliError(
        "E_IO",
        "The transaction failed and rollback could not fully restore the project.",
        { cause: new AggregateError([error, ...rollbackFailures]) },
      );
    }
    throw error;
  }
}

function ensureParents(
  projectRoot: string,
  destination: SafeDestination,
  createdDirectories: string[],
): void {
  const parent = dirname(destination.absolutePath);
  const segments = relative(projectRoot, parent).split(sep).filter(Boolean);
  let current = projectRoot;
  for (const segment of segments) {
    current = `${current}${sep}${segment}`;
    try {
      const metadata = lstatSync(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new CliError("E_SECURITY", "Destination ancestors must be real directories.", {
          path: destination.relativePath,
        });
      }
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (!isMissing(error)) throw error;
      try {
        mkdirSync(current, { mode: 0o700 });
        createdDirectories.push(current);
      } catch (mkdirError) {
        // A concurrent creator is acceptable only when it produced a real dir.
        const metadata = lstatSync(current);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw mkdirError;
      }
    }
  }
}

function assertTargetStillMatchesPlan(action: TransactionAction): void {
  try {
    const current = readFileNoFollow(action.destination.absolutePath);
    if (!action.originalContent || !current.equals(action.originalContent)) {
      throw new CliError("E_CONFLICT", "A destination changed after planning.", {
        path: action.path,
      });
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (isMissing(error) && !action.originalContent) return;
    throw new CliError("E_CONFLICT", "A destination changed after planning.", {
      cause: error,
      path: action.path,
    });
  }
}

function atomicReplace(
  projectRoot: string,
  destination: SafeDestination,
  content: Buffer,
  mode: number,
  privateFiles: Set<string>,
  beforeRename?: () => void,
): void {
  const tempPath = privateSibling(destination.absolutePath, "write");
  writePrivateFile(tempPath, content, () => {
    privateFiles.add(tempPath);
  });
  chmodSync(tempPath, mode);

  assertCurrentDestinationSafe(projectRoot, dirname(destination.absolutePath), destination.relativePath);
  const resolvedTemp = prepareDestination(projectRoot, relative(projectRoot, tempPath));
  if (!resolvedTemp.snapshots.at(-1)?.exists) {
    throw new CliError("E_SECURITY", "The private replacement file disappeared.", {
      path: destination.relativePath,
    });
  }
  beforeRename?.();
  renameSync(tempPath, destination.absolutePath);
  privateFiles.delete(tempPath);
}

function rollbackWrite(
  projectRoot: string,
  applied: AppliedWrite,
  privateFiles: Set<string>,
): void {
  const { action, backupPath } = applied;
  assertCurrentDestinationSafe(
    projectRoot,
    action.destination.absolutePath,
    action.path,
  );
  const current = readFileNoFollow(action.destination.absolutePath);
  if (!current.equals(action.content)) {
    throw new CliError("E_CONFLICT", "A written destination changed before rollback.", {
      path: action.path,
    });
  }
  if (action.action === "create") {
    unlinkSync(action.destination.absolutePath);
    return;
  }
  if (!backupPath || action.originalMode === undefined) {
    throw new CliError("E_IO", "A rollback backup is unavailable.", {
      path: action.path,
    });
  }
  const backup = readFileNoFollow(backupPath);
  atomicReplace(
    projectRoot,
    action.destination,
    backup,
    action.originalMode,
    privateFiles,
  );
}

function writePrivateFile(
  path: string,
  content: Buffer,
  onCreated: () => void,
  beforeWrite?: () => void,
): void {
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  );
  try {
    onCreated();
    beforeWrite?.();
    let offset = 0;
    while (offset < content.byteLength) {
      offset += writeSync(descriptor, content, offset, content.byteLength - offset);
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function privateSibling(path: string, purpose: string): string {
  return `${dirname(path)}${sep}.stint-${basename(path)}-${purpose}-${randomUUID()}.tmp`;
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Cleanup errors do not hide the transaction result. Private files use
    // unpredictable names and mode 0600 if cleanup is interrupted.
  }
}
