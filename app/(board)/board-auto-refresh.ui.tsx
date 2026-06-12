"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** How much visible, on-screen time must pass between auto-refreshes. */
const REFRESH_AFTER_MS = 5 * 60 * 1000;

/**
 * Invisible component that quietly refreshes the board about every five minutes
 * of *visible* on-screen time, so server-driven changes (notably the 2h
 * Blocked→NeedReview auto-move) appear without a manual reload.
 *
 * It drives a `requestAnimationFrame` loop and accumulates elapsed time only
 * while `document.visibilityState === "visible"`. rAF is paused on a hidden tab,
 * so no frames fire while backgrounded; on return, a `visibilitychange` handler
 * resets the per-frame baseline so the whole hidden gap is discarded rather than
 * counted in the first visible frame. The timer simply resumes from where it
 * paused. Renders nothing; SSR-safe (the effect runs only in the browser).
 */
export function BoardAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    let rafId = 0;
    let accumulated = 0;
    let last = performance.now();

    function tick(now: number) {
      if (document.visibilityState === "visible") {
        accumulated += now - last;
      }
      last = now;

      if (accumulated >= REFRESH_AFTER_MS) {
        accumulated = 0;
        router.refresh();
      }

      rafId = requestAnimationFrame(tick);
    }

    // On returning from a hidden tab, the first frame's `now - last` spans the
    // entire backgrounded gap. Rebase `last` to the moment of return so that gap
    // is not added to the accumulator.
    function rebaseOnVisible() {
      if (document.visibilityState === "visible") {
        last = performance.now();
      }
    }

    document.addEventListener("visibilitychange", rebaseOnVisible);
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", rebaseOnVisible);
    };
  }, [router]);

  return null;
}
