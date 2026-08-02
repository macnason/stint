type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type FourDigitYear = `${Digit}${Digit}${Digit}${Digit}`;

type January = `${FourDigitYear}-01`;
type February = `${FourDigitYear}-02`;
type March = `${FourDigitYear}-03`;
type April = `${FourDigitYear}-04`;
type May = `${FourDigitYear}-05`;
type June = `${FourDigitYear}-06`;
type July = `${FourDigitYear}-07`;
type August = `${FourDigitYear}-08`;
type September = `${FourDigitYear}-09`;
type October = `${FourDigitYear}-10`;
type November = `${FourDigitYear}-11`;
type December = `${FourDigitYear}-12`;

export type MonthString =
  | January
  | February
  | March
  | April
  | May
  | June
  | July
  | August
  | September
  | October
  | November
  | December;

export type ExperienceId = string;
export type RoleId = string;
export type PresentationId = string;

export interface StintRole {
  id: RoleId;
  title: string;
  start: MonthString;
}

export interface StintExperience {
  id: ExperienceId;
  company: string;
  location?: string;
  start: MonthString;
  /** Exclusive end month. Null denotes an entry active through the reference month. */
  end: MonthString | null;
  priority?: number;
  /** Consumer-owned key for logos and other presentation data. */
  presentationId?: PresentationId;
  roles: readonly StintRole[];
}

export interface StintConfig {
  schemaVersion: 1;
  entries: readonly StintExperience[];
}

export interface NormalizedStintRole extends StintRole {
  sourceOrder: number;
  startIndex: number;
  endIndexExclusive: number;
}

export interface NormalizedStintExperience
  extends Omit<StintExperience, "roles"> {
  priority: number;
  sourceOrder: number;
  startIndex: number;
  endIndexExclusive: number;
  isCurrent: boolean;
  roles: readonly NormalizedStintRole[];
}

export interface TimelineBounds {
  start: MonthString;
  /** Exclusive end month. */
  end: MonthString;
  firstSelectedMonth: MonthString;
  lastSelectedMonth: MonthString;
  startIndex: number;
  endIndexExclusive: number;
}

export interface NormalizedStintConfig {
  schemaVersion: 1;
  referenceMonth: MonthString;
  entries: readonly NormalizedStintExperience[];
  bounds: TimelineBounds | null;
}

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticCode =
  | "invalid-config"
  | "unsupported-schema-version"
  | "empty-entry-id"
  | "duplicate-entry-id"
  | "empty-company"
  | "invalid-month"
  | "invalid-entry-span"
  | "empty-roles"
  | "empty-role-id"
  | "duplicate-role-id"
  | "empty-role-title"
  | "role-outside-entry"
  | "zero-length-role"
  | "missing-presentation"
  | "gap"
  | "overlap"
  | "multiple-current-entries"
  | "future-entry";

export interface StintDiagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  path: string;
  message: string;
  relatedPaths?: readonly string[];
}

export interface NormalizeStintOptions {
  referenceMonth: MonthString;
}

export interface NormalizeStintResult {
  config: NormalizedStintConfig | null;
  diagnostics: readonly StintDiagnostic[];
  errors: readonly StintDiagnostic[];
  warnings: readonly StintDiagnostic[];
}

export interface StintSelection {
  month: MonthString;
  entryId?: ExperienceId;
}

export type CurrentMonthMode =
  | {
      mode: "fixed";
      month: MonthString;
    }
  | {
      mode: "live";
      initialMonth?: MonthString;
      timeZone?: string;
    };

export type ReconciliationReason = "retain" | "clamp" | "reset";

export type ReconciliationCause =
  | "selection-valid"
  | "before-bounds"
  | "after-bounds"
  | "entry-unavailable"
  | "missing-selection"
  | "invalid-month"
  | "empty-data";

export interface ReconciliationChanges {
  month: boolean;
  entry: boolean;
  role: boolean;
}

export interface ReconciliationResult {
  selection: StintSelection | null;
  reason: ReconciliationReason;
  cause: ReconciliationCause;
  changes: ReconciliationChanges;
}

export interface ReconcileSelectionOptions {
  previousConfig?: NormalizedStintConfig;
}
