"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-error";

/*
 * The other half of crash reporting (2026-08-19).
 *
 * Until now `reportClientError` was called from exactly two places —
 * app/error.tsx and app/global-error.tsx — which means Admin → Platform
 * Errors only ever saw crashes React caught while RENDERING. Everything
 * that throws outside a render was invisible:
 *
 *   - a button's onClick that throws (enabling push notifications)
 *   - a server action awaited without a catch (saving a profile)
 *   - any async callback, timer, or event handler
 *
 * That is most of the app's interactive surface, and it is exactly where
 * Mark's two crash reports landed on 2026-08-19 — neither would have left
 * a trace. An empty error page read as "no crashes", not "we aren't
 * listening", which is the more dangerous of the two mistakes to make a
 * week out from launch.
 *
 * Mounted once in the root layout. Renders nothing.
 */

/** Errors every site sees and no one can act on. */
function isNoise(message: string): boolean {
  return (
    // Cross-origin script with no detail — the browser withholds everything
    // useful, so the report would be a row saying "something, somewhere".
    message === "Script error." ||
    message === "Script error" ||
    // A benign Chrome/Safari layout notice, not a fault. Fires in bursts.
    message.startsWith("ResizeObserver loop") ||
    // Navigating away cancels in-flight fetches; that is not a crash.
    message.includes("AbortError") ||
    message.includes("The operation was aborted") ||
    // Safari/Firefox wording for the same thing.
    message.includes("cancelled") ||
    message.includes("NetworkError when attempting to fetch")
  );
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return "Unknown error";
  }
}

export function ClientErrorWatch() {
  useEffect(() => {
    /*
     * Two bounds, because the failure mode of a global handler is a loop
     * that reports itself. The server throttles email and the bell, but
     * nothing there stops a wedged page from beaconing hundreds of times.
     *
     *   seen  — the same error is reported once per page load, so a
     *           re-render loop counts as one
     *   sent  — a hard ceiling per page load, so many DISTINCT errors
     *           (a page failing in a new way each frame) still stop
     */
    const seen = new Set<string>();
    let sent = 0;
    const MAX_PER_PAGE_LOAD = 5;

    const report = (raw: unknown, kind: "uncaught" | "unhandled rejection") => {
      const message = messageOf(raw);
      if (!message || isNoise(message)) return;
      const key = `${kind}:${message}`;
      if (seen.has(key) || sent >= MAX_PER_PAGE_LOAD) return;
      seen.add(key);
      sent += 1;
      // Name the source. On the admin page a handler crash and a render
      // crash want different first questions, and the message alone
      // doesn't distinguish them.
      reportClientError({ message: `[${kind}] ${message}` });
    };

    const onError = (e: ErrorEvent) => report(e.error ?? e.message, "uncaught");
    const onRejection = (e: PromiseRejectionEvent) =>
      report(e.reason, "unhandled rejection");

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
