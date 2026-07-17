"use client";

import { useEffect, useState } from "react";

/*
 * A "now" that re-evaluates every 30 s. Session pages used to freeze
 * Date.now() at load, so a member sitting on the page at 6:59 never saw
 * the button flip to "Join Session Now" without a manual refresh.
 */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
