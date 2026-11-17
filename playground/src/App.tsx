import { useCallback, useState } from "react";
import { useWebHaptics } from "web-haptics/react";

import {
  Stint,
  type StintFeedbackHandler,
  type StintOrientation,
} from "../../packages/stint/src/index.js";
import { designers } from "./designers.js";

const REFERENCE_MONTH = { mode: "fixed", month: "2026-11" } as const;

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

  // The package only emits events; the host picks the haptics.
  const { trigger } = useWebHaptics();
  const onFeedback = useCallback<StintFeedbackHandler>(
    (event) => {
      if (event.type === "month-change") void trigger("selection");
      else if (event.type === "entry-change") void trigger("medium");
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
