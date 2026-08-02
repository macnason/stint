"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StintChangeMeta, StintInputSource } from "./feedback.js";
import {
  getOverlapCandidates,
  reconcileSelection,
  resolveActiveEntry,
  roleAt,
} from "./timeline.js";
import type {
  NormalizedStintConfig,
  NormalizedStintExperience,
  NormalizedStintRole,
  StintSelection,
} from "./types.js";

export interface UseExperienceSelectionOptions {
  config: NormalizedStintConfig | null;
  value?: StintSelection;
  defaultValue?: StintSelection;
  onChange?: (selection: StintSelection, meta: StintChangeMeta) => void;
}

export interface ExperienceSelectionState {
  /** The committed selection after reconciliation; null while data is empty. */
  selection: StintSelection | null;
  entry: NormalizedStintExperience | null;
  role: NormalizedStintRole | null;
  overlapCandidates: readonly NormalizedStintExperience[];
  /** Propose a new selection from an input source. */
  propose: (next: StintSelection, source: StintInputSource) => void;
}

function buildMeta(
  config: NormalizedStintConfig | null,
  selection: StintSelection | null,
  source: StintInputSource,
): StintChangeMeta {
  if (!config || !selection) {
    return { source, entry: null, role: null, overlapCandidates: [] };
  }
  const entry = resolveActiveEntry(config.entries, selection);
  return {
    source,
    entry,
    role: entry ? roleAt(entry, selection.month) : null,
    overlapCandidates: getOverlapCandidates(config.entries, selection.month),
  };
}

/**
 * Controlled/uncontrolled month+entry selection over a normalized config.
 * Reconciles the committed value whenever the data changes and reports
 * clamp/reset reasons through `onChange`.
 */
export function useExperienceSelection({
  config,
  value,
  defaultValue,
  onChange,
}: UseExperienceSelectionOptions): ExperienceSelectionState {
  const controlled = value !== undefined;
  const [uncontrolled, setUncontrolled] = useState<StintSelection | null>(
    () => defaultValue ?? null,
  );
  const raw = controlled ? value : uncontrolled;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Reconcile the raw selection against the current config on every render;
  // reconcileSelection is pure and cheap at this data size.
  const previousConfigRef = useRef<NormalizedStintConfig | undefined>(undefined);
  const reconciled = config
    ? reconcileSelection(raw, config, {
        previousConfig: previousConfigRef.current,
      })
    : null;
  const selection = reconciled?.selection ?? null;

  // When data changes force a clamp/reset, surface it once with its reason
  // and (when uncontrolled) adopt the corrected value.
  useEffect(() => {
    previousConfigRef.current = config ?? undefined;
    if (!config || !reconciled || !reconciled.selection) return;
    if (reconciled.reason === "retain") return;
    // A missing selection is the natural default state: leave it empty so the
    // derived value keeps tracking the newest month as live data rolls on.
    if (raw == null) return;
    const changed =
      raw?.month !== reconciled.selection.month ||
      raw?.entryId !== reconciled.selection.entryId;
    if (!changed) return;
    if (!controlled) setUncontrolled(reconciled.selection);
    onChangeRef.current?.(reconciled.selection, {
      ...buildMeta(config, reconciled.selection, "data"),
      reason: reconciled.reason,
      cause: reconciled.cause,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const selectionRef = useRef<StintSelection | null>(selection);
  selectionRef.current = selection;

  const propose = useCallback(
    (next: StintSelection, source: StintInputSource) => {
      if (!config || !config.bounds) return;
      const result = reconcileSelection(next, config);
      const accepted = result.selection;
      if (!accepted) return;
      const current = selectionRef.current;
      if (
        current &&
        current.month === accepted.month &&
        current.entryId === accepted.entryId
      ) {
        return;
      }
      if (!controlled) setUncontrolled(accepted);
      onChangeRef.current?.(accepted, buildMeta(config, accepted, source));
    },
    [config, controlled],
  );

  const entry =
    config && selection ? resolveActiveEntry(config.entries, selection) : null;
  return {
    selection,
    entry,
    role: entry && selection ? roleAt(entry, selection.month) : null,
    overlapCandidates:
      config && selection
        ? getOverlapCandidates(config.entries, selection.month)
        : [],
    propose,
  };
}
