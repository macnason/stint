// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Stint } from "../src/Stint";
import { installDom, useSafeFakeTimers, type DomHarness } from "./dom";
import { makeConfig } from "./fixtures";

vi.mock("motion", () => ({
  animate: vi.fn(() => ({ stop: vi.fn() })),
}));

const fixed = { mode: "fixed", month: "2025-06" } as const;

let dom: DomHarness;

beforeEach(() => {
  dom = installDom();
});

afterEach(() => {
  cleanup();
  dom.restore();
  vi.useRealTimers();
});

describe("slider semantics", () => {
  it("exposes month-level range, orientation, and rich value text", () => {
    render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="vertical" />,
    );
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuemin")).toBe("0");
    // Jan 2023 .. Jun 2025 inclusive = 30 months, zero-indexed.
    expect(slider.getAttribute("aria-valuemax")).toBe("29");
    expect(slider.getAttribute("aria-valuenow")).toBe("29");
    expect(slider.getAttribute("aria-orientation")).toBe("vertical");
    const valuetext = slider.getAttribute("aria-valuetext")!;
    expect(valuetext).toContain("June 2025");
    expect(valuetext).toContain("Field Notes Co");
    expect(valuetext).toContain("Lead Product Designer");
    expect(slider.getAttribute("tabindex")).toBe("0");
  });

  it("keeps orientation semantics correct in horizontal mode", () => {
    render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="horizontal" />,
    );
    expect(screen.getByRole("slider").getAttribute("aria-orientation")).toBe(
      "horizontal",
    );
  });
});

describe("logo keyboard access", () => {
  it("commits selection from keyboard activation without pointer engagement", () => {
    render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="vertical" />,
    );
    const oldest = screen.getByRole("button", { name: /North Star Labs/ });
    act(() => {
      oldest.focus();
    });
    // Keyboard activation of a button fires click.
    act(() => {
      fireEvent.click(oldest);
    });
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain(
      "North Star Labs",
    );
    expect(oldest.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("status announcements", () => {
  it("announces settled changes once without flooding during movement", () => {
    useSafeFakeTimers();
    render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="horizontal" />,
    );
    const slider = screen.getByRole("slider");
    const status = screen.getByRole("status");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const initial = status.textContent;
    expect(initial).toContain("Field Notes Co");

    // Rapid movement: no announcement between keystrokes.
    for (let i = 0; i < 20; i++) {
      act(() => {
        fireEvent.keyDown(slider, { key: "ArrowLeft" });
        vi.advanceTimersByTime(50);
      });
    }
    expect(status.textContent).toBe(initial);

    // Settling announces the final entry exactly once.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(status.textContent).toContain("North Star Labs");
  });
});

describe("automated accessibility checks", () => {
  it("reports no serious or critical violations in either orientation", async () => {
    for (const orientation of ["vertical", "horizontal"] as const) {
      cleanup();
      const { container } = render(
        <main>
          <Stint
            data={makeConfig()}
            currentMonth={fixed}
            orientation={orientation}
          />
        </main>,
      );
      const results = await axe.run(container, {
        rules: {
          // Color contrast needs a real rendering engine.
          "color-contrast": { enabled: false },
        },
      });
      const serious = results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      );
      expect(serious).toEqual([]);
    }
  });
});
