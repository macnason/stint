import { vi } from "vitest";

/**
 * Fake timeouts and the clock without touching requestAnimationFrame, which
 * the harness below owns as an explicit queue.
 */
export function useSafeFakeTimers() {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
}

export interface DomHarness {
  /** Flip the prefers-reduced-motion media query and notify listeners. */
  setReducedMotion: (matches: boolean) => void;
  /** Fire every registered ResizeObserver with the given content width. */
  resizeAll: (width: number) => void;
  /** Run queued animation frames (each flush runs one frame per pending cb). */
  flushFrames: (count?: number) => void;
  /** Number of currently queued animation frame callbacks. */
  pendingFrames: () => number;
  restore: () => void;
}

/**
 * jsdom lacks matchMedia, ResizeObserver, pointer capture, and a controllable
 * requestAnimationFrame. This harness installs deterministic versions.
 */
export function installDom(): DomHarness {
  let reduced = false;
  const mediaListeners = new Set<(event: { matches: boolean }) => void>();
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("prefers-reduced-motion") ? reduced : false;
    },
    media: query,
    addEventListener: (_: string, cb: (event: { matches: boolean }) => void) =>
      mediaListeners.add(cb),
    removeEventListener: (
      _: string,
      cb: (event: { matches: boolean }) => void,
    ) => mediaListeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;

  const resizeCallbacks = new Set<ResizeObserverCallback>();
  const observed = new Map<ResizeObserverCallback, Element[]>();
  class FakeResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      resizeCallbacks.add(callback);
      observed.set(callback, []);
    }
    observe(element: Element) {
      observed.get(this.callback)?.push(element);
    }
    unobserve() {}
    disconnect() {
      resizeCallbacks.delete(this.callback);
      observed.delete(this.callback);
    }
  }
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;

  const capture = new Map<number, Element>();
  const proto = window.Element.prototype as Element & {
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
    hasPointerCapture?: (id: number) => boolean;
  };
  const originalSet = proto.setPointerCapture;
  const originalRelease = proto.releasePointerCapture;
  const originalHas = proto.hasPointerCapture;
  proto.setPointerCapture = function (id: number) {
    capture.set(id, this as unknown as Element);
  };
  proto.releasePointerCapture = function (id: number) {
    capture.delete(id);
  };
  proto.hasPointerCapture = function (id: number) {
    return capture.get(id) === (this as unknown as Element);
  };

  let frameQueue: FrameRequestCallback[] = [];
  let frameId = 0;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frameQueue.push(cb);
    return ++frameId;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    void id;
    // Callbacks are cheap and idempotent here; cancelled frames simply run
    // against detached refs, matching the component's guard style.
  }) as typeof cancelAnimationFrame;

  return {
    setReducedMotion(matches) {
      reduced = matches;
      for (const cb of [...mediaListeners]) cb({ matches });
    },
    resizeAll(width) {
      for (const cb of [...resizeCallbacks]) {
        const elements = observed.get(cb) ?? [];
        cb(
          elements.map((target) => ({
            target,
            contentRect: { width, height: 340 } as DOMRectReadOnly,
            contentBoxSize: [{ inlineSize: width, blockSize: 340 }],
            borderBoxSize: [{ inlineSize: width, blockSize: 340 }],
            devicePixelContentBoxSize: [],
          })) as unknown as ResizeObserverEntry[],
          new FakeResizeObserver(() => {}) as unknown as ResizeObserver,
        );
      }
    },
    flushFrames(count = 1) {
      for (let i = 0; i < count; i++) {
        const queue = frameQueue;
        frameQueue = [];
        for (const cb of queue) cb(performance.now());
      }
    },
    pendingFrames() {
      return frameQueue.length;
    },
    restore() {
      window.matchMedia = originalMatchMedia;
      globalThis.ResizeObserver = originalResizeObserver;
      proto.setPointerCapture = originalSet!;
      proto.releasePointerCapture = originalRelease!;
      proto.hasPointerCapture = originalHas!;
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
      vi.restoreAllMocks();
    },
  };
}

/** Mock a stable bounding rect on an element (jsdom returns zeros). */
export function mockRect(
  element: Element,
  rect: { left?: number; top?: number; width: number; height: number },
) {
  const value = {
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: (rect.left ?? 0) + rect.width,
    bottom: (rect.top ?? 0) + rect.height,
    width: rect.width,
    height: rect.height,
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    toJSON: () => ({}),
  } as DOMRect;
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(value);
}
