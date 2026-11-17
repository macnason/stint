import { useCallback, useRef, useState } from "react";
import { useWebHaptics } from "web-haptics/react";

import {
  Stint,
  type StintFeedbackHandler,
  type StintOrientation,
} from "../../packages/stint/src/index.js";
import { designers } from "./designers.js";

const REFERENCE_MONTH = { mode: "fixed", month: "2026-11" } as const;

// `?haptics=off` rules haptics out when chasing a touch problem.
const HAPTICS =
  new URLSearchParams(window.location.search).get("haptics") !== "off";

const ORIENTATIONS = [
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
  { value: "responsive", label: "Responsive" },
] as const;

const WIDTHS = [
  { value: "360", label: "360" },
  { value: "560", label: "560" },
  { value: "full", label: "Full" },
] as const;

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

export function App() {
  const [orientation, setOrientation] = useState<StintOrientation>("horizontal");
  const [width, setWidth] = useState<(typeof WIDTHS)[number]["value"]>("full");

  // The package only emits events; the host picks the haptics. Months pass
  // far faster than a phone can tick, so tick per year and tap per company.
  const { trigger } = useWebHaptics();
  const lastYear = useRef("");
  const onFeedback = useCallback<StintFeedbackHandler>(
    (event) => {
      if (!HAPTICS) return;
      if (event.type === "entry-change") {
        void trigger("medium");
      } else if (event.type === "month-change") {
        const year = event.month.slice(0, 4);
        if (year === lastYear.current) return;
        lastYear.current = year;
        void trigger("selection");
      }
    },
    [trigger],
  );

  return (
    <div className="page">
      <header className="masthead">
        <h1>Stint</h1>
        <Segmented
          label="Orientation"
          value={orientation}
          options={ORIENTATIONS}
          onChange={setOrientation}
        />
        <Segmented label="Width" value={width} options={WIDTHS} onChange={setWidth} />
      </header>

      <main className="gallery">
        {designers.map((designer) => (
          <figure key={designer.id} className="pane" id={designer.id}>
            <figcaption>{designer.name}</figcaption>
            <div
              className="pane__stage"
              style={width === "full" ? undefined : { width: Number(width) }}
            >
              <Stint
                data={designer.data}
                orientation={orientation}
                currentMonth={REFERENCE_MONTH}
                onFeedback={onFeedback}
              />
            </div>
          </figure>
        ))}
      </main>
    </div>
  );
}
