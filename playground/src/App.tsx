import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Stint } from "../../packages/stint/src/index.js";
import { DEMOS, labelCollisions, logoSizes, measureRefreshRate } from "./demos.js";
import { designers } from "./designers.js";
import { FIXES, type Fix, type FixId, type FixKind } from "./lab/fixes.js";
import { StintLab } from "./lab/StintLab.js";

type Decision = "approved" | "denied";
type Decisions = Partial<Record<FixId, Decision>>;
type Orientation = "horizontal" | "vertical";
type Filter = "all" | "open" | Decision;

const STORAGE_KEY = "stint-lab-decisions";
const REFERENCE_MONTH = { mode: "fixed", month: "2026-11" } as const;

const KIND_LABEL: Record<FixKind, string> = {
  bug: "Bug",
  layout: "Layout shift",
  motion: "Motion",
  simplify: "Simplify",
  ui: "UI",
};

function loadDecisions(): Decisions {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Decisions;
  } catch {
    return {};
  }
}

function toMarkdown(decisions: Decisions): string {
  const lines = ["# Stint lab decisions", ""];
  for (const fix of FIXES) {
    const decision = decisions[fix.id];
    const mark = decision === "approved" ? "x" : " ";
    const state = decision ?? "undecided";
    lines.push(`- [${mark}] \`${fix.id}\` (${state}) — ${fix.title}`);
    if (decision === "approved") lines.push(`  - ${fix.change}`);
  }
  return lines.join("\n");
}

/* ---------- small controls ---------- */

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const DESIGNER_OPTIONS = designers.map((d) => ({
  value: d.id,
  label: d.name.split(" ").at(-1)!,
}));

const ORIENTATION_OPTIONS = [
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
] as const;

/* ---------- before / after pair ---------- */

function Pane({
  title,
  metric,
  width,
  children,
  paneRef,
}: {
  title: string;
  metric?: string;
  width?: number;
  children: ReactNode;
  paneRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <figure className="pane">
      <figcaption>
        <span>{title}</span>
        {metric && <output>{metric}</output>}
      </figcaption>
      <div
        ref={paneRef}
        className="pane__stage"
        style={width ? { width, maxWidth: "100%" } : undefined}
      >
        {children}
      </div>
    </figure>
  );
}

function Comparison({
  fixes,
  designerId,
  orientation,
  width,
  demo,
  staticMetric,
  replay,
}: {
  fixes: ReadonlySet<FixId>;
  designerId: string;
  orientation: Orientation;
  width?: number;
  demo?: Fix["demo"];
  staticMetric?: (root: HTMLElement) => string;
  replay?: number;
}) {
  const data = designers.find((d) => d.id === designerId)!.data;
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<[string?, string?]>([]);
  const [mount, setMount] = useState(0);
  const remount = demo === "remount";

  // Static readings refresh whenever the scene changes.
  useEffect(() => {
    if (!staticMetric) return;
    const read = () =>
      setMetrics([
        beforeRef.current ? staticMetric(beforeRef.current) : undefined,
        afterRef.current ? staticMetric(afterRef.current) : undefined,
      ]);
    const timer = setTimeout(read, 900);
    return () => clearTimeout(timer);
  }, [staticMetric, designerId, orientation, mount, fixes]);

  // A replay request runs the demo on both panes at once.
  const lastReplay = useRef(replay);
  useEffect(() => {
    if (replay === lastReplay.current) return;
    lastReplay.current = replay;
    if (remount) {
      setMount((n) => n + 1);
      return;
    }
    const runner = demo ? DEMOS[demo] : undefined;
    if (!runner || !beforeRef.current || !afterRef.current) return;
    setMetrics([]);
    void Promise.all([
      runner.run(beforeRef.current),
      runner.run(afterRef.current),
    ]).then(([before, after]) => {
      if (before.metric || after.metric) setMetrics([before.metric, after.metric]);
    });
  }, [replay, demo, remount]);

  const key = `${designerId}:${orientation}:${mount}`;
  return (
    <div className="comparison" data-orientation={orientation}>
      <Pane title="Before" metric={metrics[0]} width={width} paneRef={beforeRef}>
        <Stint
          key={key}
          data={data}
          orientation={orientation}
          currentMonth={REFERENCE_MONTH}
        />
      </Pane>
      <Pane title="After" metric={metrics[1]} width={width} paneRef={afterRef}>
        <StintLab
          key={`${key}:${[...fixes].join()}`}
          data={data}
          orientation={orientation}
          currentMonth={REFERENCE_MONTH}
          fixes={fixes}
        />
      </Pane>
    </div>
  );
}

const STATIC_METRICS: Partial<Record<FixId, (root: HTMLElement) => string>> = {
  "year-labels": (root) => {
    const count = labelCollisions(root);
    return count === 1 ? "1 label collision" : `${count} label collisions`;
  },
  "logo-scale": logoSizes,
};

/* ---------- suggestion row ---------- */

function DecisionButtons({
  decision,
  onDecide,
  title,
}: {
  decision?: Decision;
  onDecide: (decision?: Decision) => void;
  title: string;
}) {
  return (
    <div className="decision" role="group" aria-label={`Decision for ${title}`}>
      <button
        type="button"
        data-tone="approve"
        aria-pressed={decision === "approved"}
        onClick={() => onDecide(decision === "approved" ? undefined : "approved")}
      >
        Approve
      </button>
      <button
        type="button"
        data-tone="deny"
        aria-pressed={decision === "denied"}
        onClick={() => onDecide(decision === "denied" ? undefined : "denied")}
      >
        Deny
      </button>
    </div>
  );
}

function Suggestion({
  fix,
  decision,
  onDecide,
  refreshRate,
}: {
  fix: Fix;
  decision?: Decision;
  onDecide: (decision?: Decision) => void;
  refreshRate: number | null;
}) {
  const [designerId, setDesignerId] = useState(fix.designer);
  const [orientation, setOrientation] = useState<Orientation>(fix.orientation);
  const [replay, setReplay] = useState(0);
  const fixes = useMemo(() => new Set<FixId>([fix.id]), [fix.id]);
  const runner = DEMOS[fix.demo];
  const replayLabel = fix.demo === "remount" ? "Reload" : runner?.label;

  return (
    <article className="suggestion" data-decision={decision} id={fix.id}>
      <header className="suggestion__head">
        <div className="suggestion__meta">
          <span className="kind" data-kind={fix.kind}>
            {KIND_LABEL[fix.kind]}
          </span>
          <code>{fix.id}</code>
        </div>
        <h2>{fix.title}</h2>
        <DecisionButtons decision={decision} onDecide={onDecide} title={fix.title} />
      </header>

      <dl className="suggestion__body">
        <dt>Now</dt>
        <dd>{fix.problem}</dd>
        <dt>Change</dt>
        <dd>{fix.change}</dd>
        <dt>Ref</dt>
        <dd className="ref">{fix.after}</dd>
        {fix.demo === "none" && (
          <>
            <dt>Preview</dt>
            <dd>None. Code-only; approving it changes nothing on this page.</dd>
          </>
        )}
        {fix.demo === "refresh" && refreshRate && (
          <>
            <dt>Display</dt>
            <dd>
              {refreshRate}Hz — before moves{" "}
              {(refreshRate / 60).toFixed(1)}× its designed speed here
            </dd>
          </>
        )}
      </dl>

      {fix.demo !== "none" && (
        <>
          <div className="toolbar">
            <Segmented
              label="Designer"
              value={designerId}
              options={DESIGNER_OPTIONS}
              onChange={setDesignerId}
            />
            <Segmented
              label="Orientation"
              value={orientation}
              options={ORIENTATION_OPTIONS}
              onChange={setOrientation}
            />
            {replayLabel && (
              <button
                type="button"
                className="replay"
                onClick={() => setReplay((n) => n + 1)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4.5 3.5v9l8-4.5z" />
                </svg>
                {replayLabel}
              </button>
            )}
          </div>
          <Comparison
            fixes={fixes}
            designerId={designerId}
            orientation={orientation}
            width={fix.width}
            demo={fix.demo}
            staticMetric={STATIC_METRICS[fix.id]}
            replay={replay}
          />
        </>
      )}
    </article>
  );
}

/* ---------- page ---------- */

export function App() {
  const [decisions, setDecisions] = useState<Decisions>(loadDecisions);
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState(false);
  const [refreshRate, setRefreshRate] = useState<number | null>(null);
  const [combinedDesigner, setCombinedDesigner] = useState("ive");
  const [combinedOrientation, setCombinedOrientation] =
    useState<Orientation>("horizontal");
  const [combinedReplay, setCombinedReplay] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
    } catch {
      // Private mode: decisions live for this tab only.
    }
  }, [decisions]);

  useEffect(() => {
    void measureRefreshRate().then(setRefreshRate);
  }, []);

  const approved = useMemo(
    () =>
      new Set(
        FIXES.filter((fix) => decisions[fix.id] === "approved").map((fix) => fix.id),
      ),
    [decisions],
  );
  const counts = {
    approved: approved.size,
    denied: FIXES.filter((fix) => decisions[fix.id] === "denied").length,
    open: FIXES.filter((fix) => !decisions[fix.id]).length,
  };
  const visible = FIXES.filter((fix) =>
    filter === "all"
      ? true
      : filter === "open"
        ? !decisions[fix.id]
        : decisions[fix.id] === filter,
  );

  const decide = (id: FixId) => (decision?: Decision) =>
    setDecisions((current) => {
      const next = { ...current };
      if (decision) next[id] = decision;
      else delete next[id];
      return next;
    });

  const copy = async () => {
    await navigator.clipboard.writeText(toMarkdown(decisions));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="page">
      <header className="masthead">
        <h1>Stint lab</h1>
        <Segmented
          label="Filter"
          value={filter}
          options={[
            { value: "all", label: `All ${FIXES.length}` },
            { value: "open", label: `Open ${counts.open}` },
            { value: "approved", label: `Approved ${counts.approved}` },
            { value: "denied", label: `Denied ${counts.denied}` },
          ]}
          onChange={setFilter}
        />
        <button type="button" className="primary" onClick={copy}>
          {copied ? "Copied" : "Copy decisions"}
        </button>
      </header>

      <section className="combined" aria-labelledby="combined-title">
        <div className="combined__head">
          <h2 id="combined-title">
            {approved.size === 0
              ? "Approved fixes together"
              : `${approved.size} approved, together`}
          </h2>
          <div className="toolbar">
            <Segmented
              label="Designer"
              value={combinedDesigner}
              options={DESIGNER_OPTIONS}
              onChange={setCombinedDesigner}
            />
            <Segmented
              label="Orientation"
              value={combinedOrientation}
              options={ORIENTATION_OPTIONS}
              onChange={setCombinedOrientation}
            />
            <button
              type="button"
              className="replay"
              onClick={() => setCombinedReplay((n) => n + 1)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 3.5v9l8-4.5z" />
              </svg>
              Sweep
            </button>
          </div>
        </div>
        <Comparison
          fixes={approved}
          designerId={combinedDesigner}
          orientation={combinedOrientation}
          demo="sweep"
          replay={combinedReplay}
        />
      </section>

      <main className="suggestions">
        {visible.map((fix) => (
          <Suggestion
            key={fix.id}
            fix={fix}
            decision={decisions[fix.id]}
            onDecide={decide(fix.id)}
            refreshRate={refreshRate}
          />
        ))}
        {visible.length === 0 && <p className="empty">Nothing here.</p>}
      </main>
    </div>
  );
}
