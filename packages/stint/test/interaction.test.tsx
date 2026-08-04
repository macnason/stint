// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Stint } from "../src/Stint";
import { installDom, mockRect, useSafeFakeTimers, type DomHarness } from "./dom";
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

/** Mount, enable reduced motion for deterministic 1-frame settling. */
function mount(orientation: "vertical" | "horizontal") {
  dom.setReducedMotion(true);
  const utils = render(
    <Stint data={makeConfig()} currentMonth={fixed} orientation={orientation} />,
  );
  const slider = screen.getByRole("slider");
  mockRect(
    slider,
    orientation === "horizontal"
      ? { width: 600, height: 88 }
      : { width: 110, height: 340 },
  );
  return { ...utils, slider };
}

const valuetext = () =>
  screen.getByRole("slider").getAttribute("aria-valuetext") ?? "";

describe("pointer scrubbing", () => {
  it("keeps scrub starts from reaching a parent drag surface", () => {
    const onParentPointerDown = vi.fn();
    dom.setReducedMotion(true);
    const { container } = render(
      <div onPointerDown={onParentPointerDown}>
        <Stint data={makeConfig()} currentMonth={fixed} orientation="vertical" />
      </div>,
    );
    const slider = screen.getByRole("slider");
    const rail = container.querySelector<HTMLElement>(".stint__rail");
    const root = container.querySelector<HTMLElement>(".stint");

    expect(rail).not.toBeNull();
    expect(root).not.toBeNull();

    fireEvent.pointerDown(slider, { pointerId: 1, pointerType: "touch" });
    fireEvent.pointerDown(rail!, { pointerId: 2, pointerType: "touch" });
    expect(onParentPointerDown).not.toHaveBeenCalled();

    fireEvent.pointerDown(root!, { pointerId: 3, pointerType: "touch" });
    expect(onParentPointerDown).toHaveBeenCalledOnce();
  });

  it("commits the month under the pointer along the horizontal axis", () => {
    const { slider } = mount("horizontal");
    // Bounds 2023-01..2025-06 plus 6 lead / 2 trail pad months = 44 months.
    // A quarter across the axis lands early in the range.
    act(() => {
      fireEvent.pointerDown(slider, { pointerId: 1, clientX: 150, clientY: 40 });
      dom.flushFrames(4);
    });
    expect(valuetext()).toContain("North Star Labs");
    act(() => {
      fireEvent.pointerMove(slider, { pointerId: 1, clientX: 540, clientY: 40 });
      dom.flushFrames(4);
    });
    expect(valuetext()).toContain("Field Notes Co");
  });

  it("clamps pointer movement outside the axis bounds", () => {
    const { slider } = mount("horizontal");
    act(() => {
      fireEvent.pointerDown(slider, { pointerId: 1, clientX: -300, clientY: 0 });
      dom.flushFrames(4);
    });
    // Clamped to the oldest selectable month.
    expect(valuetext()).toContain("January 2023");
    act(() => {
      fireEvent.pointerMove(slider, { pointerId: 1, clientX: 5000, clientY: 0 });
      dom.flushFrames(4);
    });
    expect(valuetext()).toContain("June 2025");
  });

  it("scrubs along the vertical axis with newest at the top", () => {
    const { slider } = mount("vertical");
    act(() => {
      fireEvent.pointerDown(slider, { pointerId: 1, clientX: 50, clientY: 5 });
      dom.flushFrames(4);
    });
    expect(valuetext()).toContain("2025");
    act(() => {
      fireEvent.pointerMove(slider, { pointerId: 1, clientX: 50, clientY: 335 });
      dom.flushFrames(4);
    });
    expect(valuetext()).toContain("January 2023");
  });

  it("settles cleanly on pointer cancel and keeps the committed value", () => {
    useSafeFakeTimers();
    const { slider } = mount("horizontal");
    act(() => {
      fireEvent.pointerDown(slider, {
        pointerId: 7,
        pointerType: "touch",
        clientX: 150,
        clientY: 40,
      });
      dom.flushFrames(4);
    });
    const committed = valuetext();
    expect(committed).toContain("North Star Labs");
    act(() => {
      fireEvent.pointerCancel(slider, { pointerId: 7, pointerType: "touch" });
      vi.advanceTimersByTime(600);
      dom.flushFrames(6);
    });
    expect(valuetext()).toBe(committed);
  });

  it("pauses animation frames once idle and resumes on interaction", () => {
    useSafeFakeTimers();
    const { slider } = mount("horizontal");
    act(() => {
      dom.flushFrames(10);
      vi.advanceTimersByTime(1000);
      dom.flushFrames(10);
    });
    // Settled and disengaged: the loop stops scheduling frames.
    expect(dom.pendingFrames()).toBe(0);
    act(() => {
      fireEvent.pointerDown(slider, { pointerId: 2, clientX: 200, clientY: 40 });
    });
    expect(dom.pendingFrames()).toBeGreaterThan(0);
  });
});

describe("keyboard interaction", () => {
  it("moves one month with orientation-correct arrows", () => {
    const { slider } = mount("horizontal");
    act(() => {
      slider.focus();
    });
    const before = slider.getAttribute("aria-valuenow");
    act(() => {
      fireEvent.keyDown(slider, { key: "ArrowLeft" });
    });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(Number(before) - 1);
    act(() => {
      fireEvent.keyDown(slider, { key: "ArrowRight" });
    });
    expect(slider.getAttribute("aria-valuenow")).toBe(before);
  });

  it("uses up/down as the time axis in vertical orientation", () => {
    const { slider } = mount("vertical");
    const before = Number(slider.getAttribute("aria-valuenow"));
    act(() => {
      fireEvent.keyDown(slider, { key: "ArrowDown" });
    });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(before - 1);
    act(() => {
      fireEvent.keyDown(slider, { key: "ArrowUp" });
    });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(before);
  });

  it("moves twelve months with Page Up/Down in the same logical direction", () => {
    for (const orientation of ["vertical", "horizontal"] as const) {
      cleanup();
      const { slider } = mount(orientation);
      const max = Number(slider.getAttribute("aria-valuemax"));
      act(() => {
        fireEvent.keyDown(slider, { key: "PageDown" });
      });
      expect(Number(slider.getAttribute("aria-valuenow"))).toBe(max - 12);
      act(() => {
        fireEvent.keyDown(slider, { key: "PageUp" });
      });
      expect(Number(slider.getAttribute("aria-valuenow"))).toBe(max);
    }
  });

  it("jumps to the oldest month with Home and the newest with End, clamped", () => {
    const { slider } = mount("horizontal");
    act(() => {
      fireEvent.keyDown(slider, { key: "Home" });
    });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(0);
    expect(valuetext()).toContain("January 2023");
    // Further backward movement clamps at the oldest bound.
    act(() => {
      fireEvent.keyDown(slider, { key: "PageDown" });
    });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(0);
    act(() => {
      fireEvent.keyDown(slider, { key: "End" });
    });
    expect(slider.getAttribute("aria-valuenow")).toBe(
      slider.getAttribute("aria-valuemax"),
    );
    expect(valuetext()).toContain("June 2025");
  });
});
