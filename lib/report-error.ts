"use client";

/*
 * Client-side error reporting: the error boundaries call this so the team
 * hears about crash screens without members filing tickets. Fire-and-forget
 * — reporting must never make a broken page worse.
 */
export function reportClientError(error: {
  message?: string;
  digest?: string;
}): void {
  try {
    const payload = JSON.stringify({
      message: error.message ?? "Unknown error",
      digest: error.digest ?? "",
      path:
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : "",
    });
    if (!navigator.sendBeacon?.("/api/errors", new Blob([payload], { type: "application/json" }))) {
      void fetch("/api/errors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Never let the reporter throw.
  }
}
