/** Where a logo candidate came from, in rough order of trust. */
export type LogoSourceKind =
  | "file"
  | "site-icon"
  | "apple-touch-icon"
  | "manifest"
  | "github-avatar"
  | "linkedin-screenshot"
  | "simple-icons"
  | "favicon-service";

export type LogoTreatment = "tile" | "badge" | "mark" | "wordmark";
export type LogoConfidence = "high" | "medium" | "low";
export type LogoSurface = "white" | "transparent";

export interface LogoCandidateInput {
  readonly source: LogoSourceKind;
  readonly url?: string;
  readonly bytes: Uint8Array;
  /** Brand colour for single-colour vector sources such as Simple Icons. */
  readonly tint?: string;
}

export interface LogoEngineItem {
  readonly key: string;
  readonly candidates: readonly LogoCandidateInput[];
  /** Index of this company's slot in the LinkedIn screenshot, when known. */
  readonly screenshotSlot?: number;
}

export interface LogoEngineRequest {
  readonly items: readonly LogoEngineItem[];
  readonly surface: LogoSurface;
  readonly screenshot?: Uint8Array;
  /** Pre-compiled resvg module bytes, read by the host from the package. */
  readonly resvgWasm: Uint8Array;
}

export interface LogoChoice {
  readonly source: LogoSourceKind;
  readonly url?: string;
  readonly format: "svg" | "png" | "jpeg" | "ico" | "bmp";
  /** Pixel size of the mark itself, after trimming padding. Vectors report 1024. */
  readonly effectivePx: number;
  readonly treatment: LogoTreatment;
  readonly confidence: LogoConfidence;
  readonly accent?: string;
}

export interface LogoEngineResult {
  readonly key: string;
  readonly choice?: LogoChoice;
  readonly png?: Uint8Array;
  readonly pngDark?: Uint8Array;
  readonly rejected: readonly { readonly source: LogoSourceKind; readonly reason: string }[];
}

export interface LogoEngineResponse {
  readonly results: readonly LogoEngineResult[];
  readonly sheet: Uint8Array;
  readonly screenshot?: {
    readonly slots: number;
    readonly placeholders: number;
  };
}
