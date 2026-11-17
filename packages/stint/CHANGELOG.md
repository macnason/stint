# @macworks/stint

## 1.0.0-next.5

### Minor Changes

- [#9](https://github.com/macnason/stint/pull/9) [`b8a74ed`](https://github.com/macnason/stint/commit/b8a74ed63368776cf3e48e6a214d3e5d3ec6da93) Thanks [@macnason](https://github.com/macnason)! - Fix layout shift and rough motion in the timeline, and drop the `motion` dependency.

  - Pointer scrubbing no longer picks the wrong month once the horizontal strip has scrolled.
  - Logo scale has one source, so logos render at their designed size (18px resting, 37px active) and keyboard focus no longer jumps them.
  - The readout reserves its tallest state, so long company names no longer move the ruler or re-centre the text while scrubbing.
  - Year labels thin to every 1, 2, 5, 10 or 20 years to fit the space instead of overprinting.
  - An overflowing strip opens on the selected month and follows keyboard and logo selections.
  - On touch, the horizontal strip now scrubs instead of scrolling away, and the cursor tracks the finger tightly. On an overflowing strip, dragging into either edge scrolls it that way and a quick flick throws it. The strip owns its touches (`touch-action: none`), so a swipe that starts on it no longer scrolls the page.
  - Ticks and logos are painted before the first frame instead of flashing in.
  - Logos grow on a CSS spring and the readout eases between entries; cursor easing is time-based, so it feels the same at 60Hz and 120Hz; the edge fade eases off.
  - The badge above the readout now shows the selected month, and reads "Current" only on today's month of a current role. A custom `currentLabel` slot keeps its old behaviour.
  - `motion` is no longer a dependency; the package has no runtime dependencies beyond its React peers.
  - Axis styles are written once and driven by `--stint-axis-*` custom properties.

## 1.0.0-next.4

### Minor Changes

- [#6](https://github.com/macnason/stint/pull/6) [`5939600`](https://github.com/macnason/stint/commit/5939600175b415c2eb821728c0322af3fb6ee059) Thanks [@macnason](https://github.com/macnason)! - Add `stint logos`: find each company's logo from its own site, GitHub, Simple Icons, a favicon service or the person's LinkedIn screenshot, reject parked, redirected and placeholder sources, and render optically normalised 256px tiles with a review sheet before writing. Add a `logos` prop to `<Stint>` that renders the generated artwork, and make the copied prompt hand logo work to the CLI instead of the agent.

## 1.0.0-next.3

## 1.0.0-next.2

### Minor Changes

- Make Stint horizontal by default and add a discovered, resumable CLI setup flow with a canonical agent guide.

## 1.0.0-next.1

### Patch Changes

- Keep horizontal timelines readable and scrollable in narrow containers.
