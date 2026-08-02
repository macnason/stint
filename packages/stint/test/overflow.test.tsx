// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Stint } from "../src/Stint";
import { installDom, type DomHarness } from "./dom";
import { makeConfig } from "./fixtures";

vi.mock("motion", () => ({
  animate: vi.fn(() => ({ stop: vi.fn() })),
}));

const fixed = { mode: "fixed", month: "2025-06" } as const;
const styles = readFileSync(
  resolve(import.meta.dirname, "../src/styles.css"),
  "utf8",
);

let dom: DomHarness;

beforeEach(() => {
  dom = installDom();
});

afterEach(() => {
  cleanup();
  dom.restore();
});

describe("transparent overflow masks (AE16)", () => {
  it("fades with transparency masks instead of background-colored scrims", () => {
    expect(styles).toContain("mask-image");
    expect(styles).toContain("transparent");
    // No hardcoded surface paint anywhere in the structural sheet.
    expect(styles).not.toMatch(/background(-color)?:\s*(#|rgb|hsl|white|black)/);
  });

  it("hides native scrollbars in component-owned overflow regions", () => {
    expect(styles).toContain("::-webkit-scrollbar");
    expect(styles).toContain("scrollbar-width: none");
  });

  it("keeps the mask on an inner field so the ruler focus ring is unmasked", () => {
    expect(styles).toMatch(/\.stint__ruler:focus-visible\s*\{[^}]*outline:/);
    // The mask rules target the tick field, never the ruler itself.
    expect(styles).not.toMatch(/\.stint__ruler[^{]*\{[^}]*mask-image/);
  });

  it("reveals keyboard-focused logos fully through any masking", () => {
    expect(styles).toMatch(
      /\.stint__logo:focus-visible\s*\{[^}]*scale:\s*1\s*!important/,
    );
  });

  it("drops the fade at exhausted edges via edge-state attributes", () => {
    render(
      <Stint data={makeConfig()} currentMonth={fixed} orientation="horizontal" />,
    );
    const slider = screen.getByRole("slider");
    // Default selection is the newest month.
    expect(slider.hasAttribute("data-at-newest")).toBe(true);
    expect(slider.hasAttribute("data-at-oldest")).toBe(false);
    act(() => {
      fireEvent.keyDown(slider, { key: "Home" });
    });
    expect(slider.hasAttribute("data-at-oldest")).toBe(true);
    expect(slider.hasAttribute("data-at-newest")).toBe(false);
    // CSS consumes the attributes to zero the matching fade.
    expect(styles).toContain('[data-at-oldest]');
    expect(styles).toContain('[data-at-newest]');
    expect(styles).toContain("--stint-fade-start: 0px");
    expect(styles).toContain("--stint-fade-end: 0px");
  });
});

describe("theme presets", () => {
  const presets = readFileSync(
    resolve(import.meta.dirname, "../src/presets.css"),
    "utf8",
  );

  it("scopes presets to data-stint-theme inside a low-priority layer", () => {
    expect(presets).toContain("@layer stint-presets");
    expect(presets).toContain('[data-stint-theme="light"]');
    expect(presets).toContain('[data-stint-theme="dark"]');
    // The structural sheet never keys on the preset attribute; absence of the
    // attribute must mean fully inherited styling.
    expect(styles).not.toContain("data-stint-theme");
  });
});
