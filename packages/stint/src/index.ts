export const packageName = "Stint" as const;

export * from "./schema.js";
export * from "./timeline.js";
export type * from "./types.js";

export * from "./feedback.js";
export {
  Stint,
  type StintProps,
  type StintSlots,
  type StintLogoContext,
  type StintLogo,
  type StintLogos,
  type StintReadoutContext,
  type StintTickContext,
  type StintClassNameSlot,
} from "./Stint.js";
export {
  useExperienceSelection,
  type UseExperienceSelectionOptions,
  type ExperienceSelectionState,
} from "./useExperienceSelection.js";
export {
  useResponsiveOrientation,
  RESPONSIVE_BREAKPOINT_REM,
  type StintOrientation,
  type ResolvedOrientation,
} from "./useResponsiveOrientation.js";
export { useCurrentMonth, monthInTimeZone } from "./useCurrentMonth.js";
