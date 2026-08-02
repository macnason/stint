// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Stint } from "../src/Stint";
import type { StintFeedbackEvent } from "../src/feedback";
import { installDom, mockRect, type DomHarness } from "./dom";
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
});

describe("generic feedback events", () => {
  it("emits engage, month, and entry changes with input sources during scrubs", () => {
    dom.setReducedMotion(true);
    const events: StintFeedbackEvent[] = [];
    render(
      <Stint
        data={makeConfig()}
        currentMonth={fixed}
        orientation="horizontal"
        onFeedback={(event) => events.push(event)}
      />,
    );
    const slider = screen.getByRole("slider");
    mockRect(slider, { width: 600, height: 88 });
    act(() => {
      fireEvent.pointerDown(slider, { pointerId: 1, clientX: 120, clientY: 40 });
      dom.flushFrames(2);
    });
    expect(events.some((e) => e.type === "engage" && e.source === "pointer")).toBe(
      true,
    );
    const entryChange = events.find((e) => e.type === "entry-change");
    expect(entryChange).toMatchObject({
      entryId: "north-star",
      previousEntryId: "field-notes",
      source: "pointer",
    });
    const monthChange = events.find((e) => e.type === "month-change");
    expect(monthChange).toBeTruthy();
  });

  it("reports keyboard and logo sources distinctly", () => {
    const events: StintFeedbackEvent[] = [];
    render(
      <Stint
        data={makeConfig()}
        currentMonth={fixed}
        orientation="vertical"
        onFeedback={(event) => events.push(event)}
      />,
    );
    const oldest = screen.getByRole("button", { name: /North Star Labs/ });
    act(() => {
      oldest.click();
    });
    expect(
      events.find((e) => e.type === "entry-change" && e.source === "logo"),
    ).toBeTruthy();

    const slider = screen.getByRole("slider");
    act(() => {
      fireEvent.keyDown(slider, { key: "End" });
    });
    expect(
      events.find((e) => e.type === "entry-change" && e.source === "keyboard"),
    ).toBeTruthy();
  });

  it("carries enough stable state for consumer-owned integrations", () => {
    const events: StintFeedbackEvent[] = [];
    render(
      <Stint
        data={makeConfig()}
        currentMonth={fixed}
        orientation="vertical"
        onFeedback={(event) => events.push(event)}
      />,
    );
    act(() => {
      screen.getByRole("button", { name: /North Star Labs/ }).click();
    });
    const change = events.find((e) => e.type === "entry-change")!;
    expect(change).toHaveProperty("month");
    expect(change).toHaveProperty("entryId");
    expect(change).toHaveProperty("previousEntryId");
    expect(change).toHaveProperty("source");
  });
});

describe("portfolio integration isolation", () => {
  it("keeps concrete haptic and morphing libraries out of the package source", () => {
    const srcDir = resolve(import.meta.dirname, "../src");
    const banned = [
      "torph",
      "web-haptics",
      "border-beam",
      "next-themes",
      "vaul",
      "next/image",
      "next/link",
      "framer-motion",
      "tailwind",
    ];
    for (const file of readdirSync(srcDir)) {
      const content = readFileSync(resolve(srcDir, file), "utf8");
      for (const dependency of banned) {
        expect(
          content.includes(`"${dependency}`) || content.includes(`'${dependency}`),
          `${file} must not import ${dependency}`,
        ).toBe(false);
      }
    }
  });

  it("declares only react peers and motion as runtime dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../package.json"),
        "utf8",
      ),
    );
    expect(Object.keys(manifest.dependencies)).toEqual(["motion"]);
    expect(Object.keys(manifest.peerDependencies).sort()).toEqual([
      "react",
      "react-dom",
    ]);
  });
});
