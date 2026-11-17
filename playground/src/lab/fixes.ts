export type FixId =
  | "scrub-offset"
  | "logo-scale"
  | "reserve-readout"
  | "year-labels"
  | "scroll-follow"
  | "first-paint"
  | "logo-spring"
  | "readout-swap"
  | "refresh-rate"
  | "edge-fade"
  | "css-logos"
  | "month-pill"
  | "one-axis-css";

export type FixKind = "bug" | "layout" | "motion" | "simplify" | "ui";

export type Demo =
  | "sweep"
  | "labels"
  | "logo-size"
  | "scrub"
  | "follow"
  | "remount"
  | "logo-hop"
  | "entry-hop"
  | "refresh"
  | "edges"
  | "none";

export interface Fix {
  id: FixId;
  kind: FixKind;
  title: string;
  problem: string;
  change: string;
  after: string;
  demo: Demo;
  designer: string;
  orientation: "horizontal" | "vertical";
  /** px — panel width that shows the issue best */
  width?: number;
}

export const FIXES: Fix[] = [
  {
    id: "scrub-offset",
    kind: "bug",
    title: "Scrub lands on the wrong month once scrolled",
    problem:
      "On narrow screens the strip scrolls. The pointer maths adds scrollLeft on top of a rect that already moved, so hovering the middle picks a month far to the right.",
    change: "Drop the extra scrollLeft from pointerToTarget.",
    after: "Bug fix",
    demo: "scrub",
    designer: "ive",
    orientation: "horizontal",
    width: 360,
  },
  {
    id: "logo-scale",
    kind: "bug",
    title: "Logo scale is applied twice",
    problem:
      "CSS sets scale: 0.6 and Motion animates transform: scale(). They multiply, so a resting logo renders at 11px instead of 18px, the active one at 22px instead of 37px, and keyboard focus jumps it to 37px.",
    change:
      "One source of scale: CSS seeds transform: scale(0.6), Motion owns it from there. Focus keeps the outline, not a size jump.",
    after: "Bug fix",
    demo: "logo-size",
    designer: "scher",
    orientation: "horizontal",
  },
  {
    id: "reserve-readout",
    kind: "layout",
    title: "Readout height changes as you scrub",
    problem:
      "A long company name wraps to two lines and pushes the ruler down mid-drag, so the thing under your finger moves. Vertical mode re-centres the text on every change.",
    change:
      "Stack every entry's readout in one grid cell, hidden sizers set the height, the live one sits on top.",
    after: "Paco Coursey · zero layout shift",
    demo: "sweep",
    designer: "vignelli",
    orientation: "horizontal",
    width: 360,
  },
  {
    id: "year-labels",
    kind: "layout",
    title: "Year labels collide on long careers",
    problem:
      "Every January gets a label regardless of space. Forty years in 560px is 14px per label and the digits overprint.",
    change:
      "Measure px per year and label every 1, 2, 5, 10 or 20 years so labels keep 44px (20px vertical). Ticks stay.",
    after: "Edward Tufte · data-ink",
    demo: "labels",
    designer: "rams",
    orientation: "horizontal",
  },
  {
    id: "scroll-follow",
    kind: "layout",
    title: "Selected month starts off-screen",
    problem:
      "When the strip overflows it opens scrolled to the oldest year, while the selection is today. Arrow keys and logo taps can also move the cursor out of view.",
    change:
      "Centre the cursor on mount. Smooth-scroll when a keyboard or logo commit lands within 32px of an edge.",
    after: "Apple · keep the subject in view",
    demo: "follow",
    designer: "kare",
    orientation: "horizontal",
    width: 360,
  },
  {
    id: "first-paint",
    kind: "motion",
    title: "Flash on first paint",
    problem:
      "Ticks are painted in the first rAF after mount, so frame one shows a flat grey ruler. Logos grow from 0.6 on every page load.",
    change:
      "Measure and paint in a layout effect. Seed logo scale and opacity synchronously; only later changes animate.",
    after: "Rauno Freiberg · invisible details",
    demo: "remount",
    designer: "ive",
    orientation: "horizontal",
  },
  {
    id: "logo-spring",
    kind: "motion",
    title: "Logo grow hesitates, then overshoots",
    problem:
      "Growth waits 80ms, then runs a 550ms back-in-out curve that dips below its start before growing. Fast scrubbing restarts it from zero each time.",
    change:
      "Spring (visualDuration 0.35, bounce 0.25) for grow, critically damped 0.22 for shrink. Retargets keep velocity.",
    after: "Apple · Designing Fluid Interfaces",
    demo: "logo-hop",
    designer: "scher",
    orientation: "horizontal",
  },
  {
    id: "readout-swap",
    kind: "motion",
    title: "Readout text hard-cuts",
    problem:
      "Company and role swap in a single frame, so it reads as a glitch rather than a change.",
    change:
      "180ms ease-out: opacity, 4px rise, 3px blur. Role line animates alone on role changes. Off under reduced motion.",
    after: "Emil Kowalski · blur masks the swap",
    demo: "entry-hop",
    designer: "ive",
    orientation: "horizontal",
  },
  {
    id: "refresh-rate",
    kind: "motion",
    title: "Cursor easing depends on refresh rate",
    problem:
      "The cursor closes 22% of the gap per frame. On 120Hz ProMotion it settles twice as fast as on 60Hz; dropped frames slow it.",
    change: "Time-based: 1 − 0.78^(dt / 16.67ms). Same feel at any refresh rate.",
    after: "Apple · ProMotion guidance",
    demo: "refresh",
    designer: "ive",
    orientation: "vertical",
  },
  {
    id: "edge-fade",
    kind: "motion",
    title: "Edge fade snaps off",
    problem:
      "Reaching the first or last month removes the ruler's edge mask in one frame.",
    change: "Register the fade lengths with @property and transition them over 240ms.",
    after: "Rauno Freiberg · invisible details",
    demo: "edges",
    designer: "kare",
    orientation: "horizontal",
  },

  {
    id: "css-logos",
    kind: "simplify",
    title: "Drop Motion; let CSS spring the logos",
    problem:
      "Motion is the package's only runtime dependency and it animates one thing: logo scale and opacity. That costs consumers a second animation library and keeps the double-scale bug alive.",
    change:
      "Write the target scale to a CSS variable. A sampled-spring linear() transition grows, a 220ms ease-out shrinks. Retargets start from the current value. Supersedes logo-scale and logo-spring.",
    after: "Emil Kowalski · CSS first",
    demo: "logo-hop",
    designer: "scher",
    orientation: "horizontal",
  },
  {
    id: "month-pill",
    kind: "ui",
    title: "Show the month you're on",
    problem:
      "The scrubbed month is only in aria-valuetext. Sighted users get no month, and non-current roles leave a 40px blank where the Current badge sits.",
    change:
      "The badge slot always shows the selected month (tabular), and reads Current only at today's month of a current role.",
    after: "Dieter Rams · as little design as possible",
    demo: "sweep",
    designer: "ive",
    orientation: "horizontal",
  },
  {
    id: "one-axis-css",
    kind: "simplify",
    title: "One set of axis rules, not two",
    problem:
      "styles.css writes every axis rule twice: once for [data-axis] and again inside the responsive container queries. ~130 duplicated lines that drift.",
    change:
      "Axis rules set --stint-axis-* custom properties; [data-axis] and the container query only flip those properties. Code-only, no visual change.",
    after: "Code health",
    demo: "none",
    designer: "ive",
    orientation: "horizontal",
  },
];
