"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/**
 * Loads the WebGL background only after the page is idle.
 *
 * The particle system is the template's, but shipping three/R3F in the critical
 * path delays first paint. Deferring it keeps the hero text instant while the
 * field streams in behind it. The static backdrop below is purely decorative
 * and does not represent data.
 */
const GL = dynamic(() => import("./index").then((mod) => mod.GL), {
  ssr: false,
});

export function LazyGL({ hovering }: { hovering: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const win = window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    let idleHandle: number | undefined;
    let timer: number | undefined;

    const schedule = () => {
      if (typeof win.requestIdleCallback === "function") {
        idleHandle = win.requestIdleCallback(() => setShow(true), {
          timeout: 2000,
        });
      } else {
        timer = window.setTimeout(() => setShow(true), 200);
      }
    };

    // Wait for the document to finish loading so the hero paints first, then
    // hand off to the browser's idle scheduling. No fixed visual delay.
    if (document.readyState === "complete") {
      schedule();
    } else {
      window.addEventListener("load", schedule, { once: true });
    }

    return () => {
      window.removeEventListener("load", schedule);
      if (idleHandle !== undefined) win.cancelIdleCallback?.(idleHandle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <div className="arc-hero-backdrop" aria-hidden="true" />
      {show ? <GL hovering={hovering} /> : null}
    </>
  );
}
