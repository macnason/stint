// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Stint } from "../src/Stint";
import { installDom, mockRect, type DomHarness } from "./dom";
import { makeConfig } from "./fixtures";

const animateMock = vi.fn(() => ({ stop: vi.fn() }));
vi.mock("motion", () => ({
  animate: (...args: unknown[]) => animateMock(...args),
}));

const fixed = { mode: "fixed", month: "2025-06" } as const;

let dom: DomHarness;

beforeEach(() => {
  animateMock.mockClear();
  dom = installDom();
});

afterEach(() => {
  cleanup();
  dom.restore();
});

describe("reduced motion", () => {
  it("removes interpolation immediately when the preference flips at runtime", () => {
    const { container } = render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="horizontal" />,
    );
    const root = container.firstElementChild!;
    expect(root.hasAttribute("data-reduced-motion")).toBe(false);

    act(() => {
      dom.setReducedMotion(true);
    });
    expect(root.hasAttribute("data-reduced-motion")).toBe(true);

    // Every scale animation issued after the flip must be instantaneous.
    animateMock.mockClear();
    const oldest = screen.getByRole("button", { name: /North Star Labs/ });
    act(() => {
      oldest.click();
    });
    expect(animateMock).toHaveBeenCalled();
    for (const call of animateMock.mock.calls) {
      expect((call[2] as { duration?: number }).duration).toBe(0);
    }
  });

  it("keeps semantic state current while motion is disabled", () => {
    dom.setReducedMotion(true);
    render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="horizontal" />,
    );
    const slider = screen.getByRole("slider");
    mockRect(slider, { width: 600, height: 88 });
    act(() => {
      fireEvent.pointerDown(slider, { pointerId: 1, clientX: 120, clientY: 40 });
      // Reduced motion means the cursor lands in a single frame.
      dom.flushFrames(1);
    });
    expect(slider.getAttribute("aria-valuetext")).toContain("North Star Labs");
  });

  it("settles the cursor in one frame under reduced motion", () => {
    dom.setReducedMotion(true);
    render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="horizontal" />,
    );
    const slider = screen.getByRole("slider");
    act(() => {
      fireEvent.keyDown(slider, { key: "PageDown" });
      dom.flushFrames(1);
    });
    act(() => {
      dom.flushFrames(1);
    });
    // Loop stops immediately after the single settling frame.
    expect(dom.pendingFrames()).toBe(0);
  });
});
