# @macworks/stint

A tactile React timeline for presenting career history — scrub through a work
history by month and watch the active role, company, and location resolve as you
move.

```bash
npm install @macworks/stint
```

React 18.2 or 19 is a peer dependency.

## Usage

```tsx
import { Stint } from "@macworks/stint";
import "@macworks/stint/styles.css";

const data = {
  schemaVersion: 1,
  entries: [
    {
      id: "acme",
      company: "Acme",
      location: "London",
      start: "2021-03",
      end: null, // current role
      roles: [{ id: "acme-design", title: "Design Engineer", start: "2021-03" }],
    },
  ],
} as const;

export function CareerTimeline() {
  return <Stint data={data} />;
}
```

`styles.css` is structural only. `presets.css` is optional and ships a small set
of themed token values:

```ts
import "@macworks/stint/presets.css";
```

## The component owns no container

Stint paints no background, border, or elevation. Colour and typography inherit
from the host page through `currentColor` plus a namespaced token set, so it
drops onto any surface. Overflow fades are transparency masks, not coloured
scrims — they work on a photo background as readily as on a flat one.

## Data model

Data is month-precision and serializable. Starts are inclusive, ends are
exclusive, and `null` means "active through the current month". Overlaps and
gaps are preserved rather than flattened, because a real career has both.

`MonthString` is a literal `YYYY-MM` template type, so malformed months fail at
compile time. Validate at runtime with the schema entry point:

```ts
import { normalizeStintConfig } from "@macworks/stint/schema";

const { config, diagnostics } = normalizeStintConfig(data);
```

Diagnostics are structured (`severity`, `code`, `path`, `message`) and cover
gaps, overlaps, multiple current entries, roles outside their employer's span,
and future-dated entries. The component surfaces the same set through
`onDiagnostics`.

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `data` | `StintConfig` | Required. Consumer-supplied config in the public schema. |
| `value` / `defaultValue` | `StintSelection` | Controlled and uncontrolled selection. |
| `onChange` | `(selection, meta) => void` | Fires on commit and on scrub. |
| `onFeedback` | `StintFeedbackHandler` | Generic feedback events — wire your own haptics. |
| `onDiagnostics` | `(diagnostics) => void` | Structural problems in `data`. |
| `currentMonth` | `CurrentMonthMode` | Override the reference month; useful for tests. |
| `orientation` | `StintOrientation` | `horizontal` by default; choose `vertical` or `responsive` when needed. |
| `resetOnLeave` | `boolean` | Off by default; committed selections survive pointer leave. |
| `locale` / `labels` | `string` / `object` | Month formatting and accessible labels. |
| `slots` / `classNames` | `StintSlots` / record | Render slots for logo, readout, and ticks. |
| `getTickColor` | `(context) => string \| null` | Per-tick accent paint inside the active band. |

Integrations stay generic. The package emits feedback events and exposes render
slots; concrete haptics, text-morphing, and image primitives belong to you.

On a horizontal axis, the rail and ruler live in a component-owned horizontal
scroll viewport, so month labels keep their spacing on narrow screens. The
default track is `560px` wide; tune it from the host only when your timeline
needs more or less density:

```css
.stint {
  --stint-horizontal-min-width: 640px;
}
```

## Hooks

`useExperienceSelection`, `useResponsiveOrientation`, and `useCurrentMonth` are
exported for building a custom presentation on the same selection logic.

## Authoring data

[`@macworks/stint-cli`](https://github.com/macnason/stint/tree/main/packages/stint-cli)
scaffolds a config, adds employers and roles, validates a timeline, and imports
from JSON, YAML, or a LinkedIn export.

## License

MIT © Mac Nason
