// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardAutoRefresh } from "./board-auto-refresh.ui";

const FIVE_MIN_MS = 5 * 60 * 1000;

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

let rafCallback: FrameRequestCallback | null = null;
let nowValue = 0;

/** Drives the captured rAF tick with the current stubbed `performance.now`. */
function tick() {
  const cb = rafCallback;
  if (!cb) throw new Error("no rAF callback registered");
  cb(nowValue);
}

/** Sets the tab visibility jsdom reports to the component. */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
}

/** Switches visibility and fires the `visibilitychange` the component listens for. */
function changeVisibility(state: "visible" | "hidden") {
  setVisibility(state);
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  rafCallback = null;
  nowValue = 0;
  refresh.mockClear();
  setVisibility("visible");
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCallback = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("performance", { now: () => nowValue });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BoardAutoRefresh", () => {
  it("refreshes the board after ~5 minutes of visible time", () => {
    render(<BoardAutoRefresh />);

    // First frame establishes the baseline timestamp (no refresh yet)
    tick();
    expect(refresh).not.toHaveBeenCalled();

    // Advance 5 minutes of visible wall-clock and tick again
    nowValue = FIVE_MIN_MS + 1;
    tick();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not count time while the tab is hidden", () => {
    render(<BoardAutoRefresh />);

    // Baseline frame while visible
    tick();

    // Tab goes to the background; 5+ minutes pass before the next frame
    setVisibility("hidden");
    nowValue = FIVE_MIN_MS + 1;
    tick();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not count the backgrounded gap on the first frame after returning visible", () => {
    render(<BoardAutoRefresh />);

    // Baseline frame while visible
    tick();

    // Tab is backgrounded; rAF is paused so no frames fire. 5+ minutes elapse.
    changeVisibility("hidden");
    nowValue = FIVE_MIN_MS + 1;

    // Tab returns to the foreground and the next frame fires. Its raw delta spans
    // the whole hidden gap, but that gap must not trigger a refresh.
    changeVisibility("visible");
    tick();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops its animation-frame loop when unmounted", () => {
    const { unmount } = render(<BoardAutoRefresh />);
    tick();

    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
