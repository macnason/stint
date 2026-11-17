import type { Demo } from "./lab/fixes.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const key = (el: Element, name: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));

const top = (root: Element, selector: string) =>
  root.querySelector(selector)?.getBoundingClientRect().top ?? 0;

export interface DemoResult {
  metric?: string;
}

/** Sweeps the slider by keyboard and sums how far the ruler and title move. */
async function sweep(root: HTMLElement): Promise<DemoResult> {
  const slider = root.querySelector<HTMLElement>("[role=slider]");
  if (!slider) return {};
  slider.focus({ preventScroll: true });
  key(slider, "Home");
  await wait(120);
  let ruler = top(root, ".stint__ruler");
  let title = top(root, ".stint__company");
  let shift = 0;
  for (let i = 0; i < 80; i++) {
    key(slider, "PageUp");
    await wait(70);
    const nextRuler = top(root, ".stint__ruler");
    const nextTitle = top(root, ".stint__company");
    shift += Math.abs(nextRuler - ruler) + Math.abs(nextTitle - title);
    ruler = nextRuler;
    title = nextTitle;
    if (slider.dataset.atNewest !== undefined) break;
  }
  slider.blur();
  return { metric: `${Math.round(shift)}px layout shift` };
}

/** Counts overlapping year labels. */
export function labelCollisions(root: HTMLElement): number {
  const boxes = [...root.querySelectorAll(".stint__tickLabel")].map((el) =>
    el.getBoundingClientRect(),
  );
  let count = 0;
  for (let i = 1; i < boxes.length; i++) {
    const a = boxes[i - 1]!;
    const b = boxes[i]!;
    const overlapX = a.right > b.left + 1 && b.right > a.left + 1;
    const overlapY = a.bottom > b.top + 1 && b.bottom > a.top + 1;
    if (overlapX && overlapY) count++;
  }
  return count;
}

export function logoSizes(root: HTMLElement): string {
  const logos = [...root.querySelectorAll<HTMLElement>(".stint__logo")];
  const active = logos.find((el) => el.dataset.active !== undefined);
  const rest = logos.find((el) => el.dataset.active === undefined);
  const px = (el?: HTMLElement) =>
    el ? Math.round(el.getBoundingClientRect().width) : 0;
  return `active ${px(active)}px · rest ${px(rest)}px`;
}

/** Hovers the middle of a scrolled strip and reports the month it picked. */
async function scrub(root: HTMLElement): Promise<DemoResult> {
  const viewport = root.querySelector<HTMLElement>(".stint__timeline");
  const ruler = root.querySelector<HTMLElement>(".stint__ruler");
  if (!viewport || !ruler) return {};
  viewport.scrollLeft = viewport.scrollWidth;
  await frame();
  const viewRect = viewport.getBoundingClientRect();
  const rect = ruler.getBoundingClientRect();
  const clientX = viewRect.left + viewRect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const init = { bubbles: true, clientX, clientY, pointerType: "mouse" };
  ruler.dispatchEvent(new PointerEvent("pointerover", init));
  ruler.dispatchEvent(new PointerEvent("pointerenter", init));
  ruler.dispatchEvent(new PointerEvent("pointermove", init));
  await wait(700);
  const picked = ruler.getAttribute("aria-valuetext")?.split(" — ")[0] ?? "";
  ruler.dispatchEvent(new PointerEvent("pointerleave", init));
  ruler.dispatchEvent(new PointerEvent("pointerout", init));
  return { metric: `pointer at centre → ${picked}` };
}

/** Whether the most magnified tick (the cursor) sits inside the viewport. */
export function selectionVisible(root: HTMLElement): boolean {
  const viewport = root.querySelector<HTMLElement>(".stint__timeline");
  if (!viewport) return true;
  let cursor: HTMLElement | undefined;
  let best = 0;
  for (const tick of root.querySelectorAll<HTMLElement>(".stint__tick")) {
    const scale = Number(/scale[XY]\(([\d.]+)\)/.exec(tick.style.transform)?.[1] ?? 0);
    if (scale > best) {
      best = scale;
      cursor = tick;
    }
  }
  if (!cursor) return true;
  const v = viewport.getBoundingClientRect();
  const c = cursor.getBoundingClientRect();
  return c.left >= v.left && c.right <= v.right;
}

async function follow(root: HTMLElement): Promise<DemoResult> {
  const slider = root.querySelector<HTMLElement>("[role=slider]");
  if (!slider) return {};
  const yes = (v: boolean) => (v ? "in view" : "off-screen");
  const onLoad = selectionVisible(root);
  slider.focus({ preventScroll: true });
  key(slider, "Home");
  await wait(900);
  const afterHome = selectionVisible(root);
  key(slider, "End");
  await wait(900);
  const afterEnd = selectionVisible(root);
  slider.blur();
  return {
    metric: `load ${yes(onLoad)} · Home ${yes(afterHome)} · End ${yes(afterEnd)}`,
  };
}

async function clickLogos(root: HTMLElement, gap: number): Promise<DemoResult> {
  const logos = [...root.querySelectorAll<HTMLElement>(".stint__logo")];
  for (const logo of [...logos, ...logos.slice(0, -1).reverse()]) {
    logo.click();
    await wait(gap);
  }
  return {};
}

async function edges(root: HTMLElement): Promise<DemoResult> {
  const slider = root.querySelector<HTMLElement>("[role=slider]");
  if (!slider) return {};
  slider.focus({ preventScroll: true });
  for (const name of ["Home", "PageUp", "End", "PageDown", "End"]) {
    key(slider, name);
    await wait(700);
  }
  slider.blur();
  return {};
}

async function travel(root: HTMLElement): Promise<DemoResult> {
  const slider = root.querySelector<HTMLElement>("[role=slider]");
  if (!slider) return {};
  slider.focus({ preventScroll: true });
  key(slider, "Home");
  await wait(1200);
  key(slider, "End");
  await wait(1200);
  slider.blur();
  return {};
}

export const DEMOS: Partial<
  Record<Demo, { label: string; run: (root: HTMLElement) => Promise<DemoResult> }>
> = {
  sweep: { label: "Sweep", run: sweep },
  scrub: { label: "Hover centre", run: scrub },
  follow: { label: "Home, End", run: follow },
  "logo-hop": { label: "Tap logos fast", run: (root) => clickLogos(root, 160) },
  "entry-hop": { label: "Tap logos", run: (root) => clickLogos(root, 650) },
  edges: { label: "Hit both ends", run: edges },
  refresh: { label: "Oldest to newest", run: travel },
};

/** Approximate display refresh rate from a short rAF sample. */
export async function measureRefreshRate(): Promise<number> {
  const stamps: number[] = [];
  for (let i = 0; i < 31; i++) stamps.push((await frame()) as number);
  const deltas = stamps.slice(1).map((t, i) => t - stamps[i]!);
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)] ?? 16.7;
  return Math.round(1000 / median);
}
