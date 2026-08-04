// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Stint } from "../src/Stint";
import type { StintConfig, StintSelection } from "../src/types";
import type { StintChangeMeta } from "../src/feedback";
import { installDom, type DomHarness } from "./dom";
import { makeConfig } from "./fixtures";

vi.mock("motion", () => ({
  animate: vi.fn(() => ({ stop: vi.fn() })),
}));

const fixed = { mode: "fixed", month: "2025-06" } as const;

function overlapConfig(): StintConfig {
  return makeConfig({
    entries: [
      {
        id: "studio",
        company: "Studio A",
        start: "2022-01",
        end: "2024-01",
        priority: 5,
        roles: [{ id: "studio-role", title: "Designer", start: "2022-01" }],
      },
      {
        id: "side",
        company: "Side Project",
        start: "2023-01",
        end: "2023-07",
        priority: 1,
        roles: [{ id: "side-role", title: "Founder", start: "2023-01" }],
      },
    ],
  });
}

let dom: DomHarness;

beforeEach(() => {
  dom = installDom();
});

afterEach(() => {
  cleanup();
  dom.restore();
  vi.useRealTimers();
});

describe("<Stint /> rendering", () => {
  it("renders a logo per entry and the newest entry's readout by default", () => {
    render(<Stint data={makeConfig()} currentMonth={fixed} orientation="vertical" />);
    expect(screen.getByRole("button", { name: /North Star Labs/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Field Notes Co/ })).toBeTruthy();
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuetext")).toContain("Field Notes Co");
    expect(slider.getAttribute("aria-valuetext")).toContain(
      "Lead Product Designer",
    );
  });

  it("uses the horizontal axis when orientation is omitted", () => {
    const { container } = render(
      <Stint data={makeConfig()} currentMonth={fixed} />,
    );
    const root = container.firstElementChild!;
    expect(root.getAttribute("data-orientation")).toBe("horizontal");
    expect(root.getAttribute("data-axis")).toBe("horizontal");
    expect(screen.getByRole("slider").getAttribute("aria-orientation")).toBe(
      "horizontal",
    );
  });

  it("renders nothing for invalid data and reports diagnostics", () => {
    const onDiagnostics = vi.fn();
    const { container } = render(
      <Stint
        data={{ schemaVersion: 1, entries: [{ bad: true }] } as unknown as StintConfig}
        currentMonth={fixed}
        onDiagnostics={onDiagnostics}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(onDiagnostics).toHaveBeenCalled();
    expect(
      onDiagnostics.mock.calls[0][0].some(
        (d: { severity: string }) => d.severity === "error",
      )
    ).toBe(true);
  });

  it("places the readout before the rail and ruler in horizontal DOM order", () => {
    const { container } = render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="horizontal" />,
    );
    const root = container.firstElementChild!;
    expect(root.firstElementChild?.className).toContain("stint__readout");
    const timeline = root.querySelector(".stint__timeline")!;
    const children = [...timeline.children].map((el) => el.className);
    expect(children[0]).toContain("stint__rail");
    expect(children[1]).toContain("stint__ruler");
    expect(root.getAttribute("data-axis")).toBe("horizontal");
  });

  it("keeps SSR-stable markup in responsive mode and syncs semantics after measurement", () => {
    const { container } = render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="responsive" />,
    );
    const root = container.firstElementChild!;
    expect(root.getAttribute("data-orientation")).toBe("responsive");
    // Pre-measurement default is the vertical axis.
    expect(screen.getByRole("slider").getAttribute("aria-orientation")).toBe(
      "vertical",
    );
    act(() => dom.resizeAll(500));
    expect(screen.getByRole("slider").getAttribute("aria-orientation")).toBe(
      "horizontal",
    );
    act(() => dom.resizeAll(900));
    expect(screen.getByRole("slider").getAttribute("aria-orientation")).toBe(
      "vertical",
    );
  });
});

describe("<Stint /> selection", () => {
  it("commits logo selection in uncontrolled mode and preserves it after leave", () => {
    render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="vertical" />,
    );
    const oldest = screen.getByRole("button", { name: /North Star Labs/ });
    act(() => {
      oldest.click();
    });
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain(
      "North Star Labs",
    );
    // Pointer leaves the widget: committed selection remains by default.
    vi.useFakeTimers();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain(
      "North Star Labs",
    );
  });

  it("emits proposals in controlled mode while rendering the parent's value", () => {
    const changes: StintSelection[] = [];
    const value: StintSelection = { month: "2024-06", entryId: "field-notes" };
    render(
      <Stint
        data={makeConfig()}
        currentMonth={fixed}
        orientation="vertical"
        value={value}
        onChange={(next) => changes.push(next)}
      />,
    );
    const oldest = screen.getByRole("button", { name: /North Star Labs/ });
    act(() => {
      oldest.click();
    });
    expect(changes.length).toBe(1);
    expect(changes[0].entryId).toBe("north-star");
    // Parent did not accept: the rendered value still follows `value`.
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain(
      "Field Notes Co",
    );
  });

  it("resolves overlapping months by priority but honors direct logo selection", () => {
    const metas: StintChangeMeta[] = [];
    render(
      <Stint
        data={overlapConfig()}
        currentMonth={fixed}
        orientation="vertical"
        defaultValue={{ month: "2023-03" }}
        onChange={(_, meta) => metas.push(meta)}
      />,
    );
    // Priority winner is Studio A at the shared month.
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain(
      "Studio A",
    );
    const side = screen.getByRole("button", { name: /Side Project/ });
    act(() => {
      side.click();
    });
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain(
      "Side Project",
    );
    const last = metas.at(-1)!;
    expect(last.overlapCandidates.map((c) => c.id)).toEqual(["studio", "side"]);
  });

  it("reconciles selection with reason metadata when data changes", () => {
    const events: { selection: StintSelection; meta: StintChangeMeta }[] = [];
    const { rerender } = render(
      <Stint
        data={makeConfig()}
        currentMonth={fixed}
        orientation="vertical"
        defaultValue={{ month: "2023-03", entryId: "north-star" }}
        onChange={(selection, meta) => events.push({ selection, meta })}
      />,
    );
    // Shrink the dataset so the committed month falls outside bounds.
    const shrunk = makeConfig({
      entries: [makeConfig().entries[1]],
    });
    rerender(
      <Stint
        data={shrunk}
        currentMonth={fixed}
        orientation="vertical"
        defaultValue={{ month: "2023-03", entryId: "north-star" }}
        onChange={(selection, meta) => events.push({ selection, meta })}
      />,
    );
    const reconciled = events.find((event) => event.meta.reason);
    expect(reconciled).toBeTruthy();
    expect(["clamp", "reset"]).toContain(reconciled!.meta.reason);
    expect(reconciled!.selection.month).toBe("2024-01");
  });
});

describe("<Stint /> current month modes", () => {
  it("keeps fixed mode deterministic", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="vertical" />,
    );
    // The open-ended entry ends at the fixed month, not the system month.
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuetext")).toContain("June 2025");
  });

  it("rolls an SSR seed forward to the live month after hydration (AE15)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    render(
      <Stint
        data={makeConfig()}
        orientation="vertical"
        currentMonth={{ mode: "live", initialMonth: "2026-01", timeZone: "UTC" }}
      />,
    );
    const slider = screen.getByRole("slider");
    // The mount effect detects the stale seed and rolls forward immediately.
    expect(slider.getAttribute("aria-valuetext")).toContain("March 2026");
  });

  it("updates live mode at a simulated month rollover", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T23:30:00Z"));
    render(
      <Stint
        data={makeConfig()}
        orientation="vertical"
        currentMonth={{ mode: "live", initialMonth: "2026-03", timeZone: "UTC" }}
      />,
    );
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain(
      "March 2026",
    );
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    });
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain(
      "April 2026",
    );
  });
});
