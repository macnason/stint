import type {
  MonthString,
  NormalizedStintExperience,
  NormalizedStintRole,
  ReconciliationCause,
  ReconciliationReason,
} from "./types.js";

/** Where a state change originated. */
export type StintInputSource =
  | "pointer"
  | "keyboard"
  | "logo"
  | "reset"
  | "data";

/**
 * Generic, consumer-facing feedback events. The package never imports a
 * concrete haptic or morphing library; consumers translate these events into
 * whatever feedback their host application owns.
 */
export type StintFeedbackEvent =
  | { type: "engage"; source: StintInputSource }
  | { type: "release"; source: StintInputSource }
  | {
      type: "month-change";
      month: MonthString;
      source: StintInputSource;
    }
  | {
      type: "entry-change";
      month: MonthString;
      entryId: string | null;
      previousEntryId: string | null;
      source: StintInputSource;
    }
  | {
      type: "role-change";
      month: MonthString;
      entryId: string | null;
      roleId: string | null;
      previousRoleId: string | null;
      source: StintInputSource;
    };

/** Metadata passed alongside every selection change. */
export interface StintChangeMeta {
  source: StintInputSource;
  entry: NormalizedStintExperience | null;
  role: NormalizedStintRole | null;
  /** Every entry containing the selected month, best candidate first. */
  overlapCandidates: readonly NormalizedStintExperience[];
  reason?: ReconciliationReason;
  cause?: ReconciliationCause;
}

export type StintFeedbackHandler = (event: StintFeedbackEvent) => void;
