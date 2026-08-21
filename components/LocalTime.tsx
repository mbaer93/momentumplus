"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  EVENT_TZ,
  formatAt,
  safeZone,
  showsAClock,
  viewerTimeZone,
  type TimeStyle,
} from "@/lib/time-format";

/*
 * Times of day, in the reader's own zone (Matt, 2026-08-21: "users who are
 * in other time zones should see the adjusted time to their location. But
 * if someone travels to us for the event the times should be readjusted
 * back to EST").
 *
 * Both halves of that come from one rule — render in the zone the device
 * reports — because a laptop that flies to New Jersey starts reporting
 * Eastern on arrival. There is nothing to detect and nothing to set.
 *
 * WHY THE ZONE ARRIVES AFTER MOUNT, NOT DURING RENDER. The server has no
 * idea what zone the reader is in; it is not in the request. Reading the
 * browser's zone while rendering would therefore produce one string on the
 * server and a different one in the browser, which is precisely the
 * hydration mismatch that took /admin/security down on 2026-08-21. So the
 * first render — on both sides — uses the event's zone, the two agree, and
 * the effect swaps in the reader's zone immediately afterwards. Someone in
 * Eastern never sees a change because there is none to make. Someone in
 * Denver sees one frame of ET first, which is the price of not being told
 * the zone until the browser is running.
 */

const TimeZoneContext = createContext<string>(EVENT_TZ);

/**
 * Resolves the reader's zone once, for the whole tree.
 *
 * One provider rather than an effect inside every timestamp: a dashboard
 * renders twenty of these, and twenty independent effects means twenty
 * re-renders to say the same thing.
 */
export function TimeZoneProvider({ children }: { children: React.ReactNode }) {
  const [zone, setZone] = useState<string>(EVENT_TZ);

  useEffect(() => {
    // Compared against EVENT_TZ rather than against `zone`, which is what
    // it starts as: reading the state here would put it in the dependency
    // list and re-run this on every change it makes.
    const local = safeZone(viewerTimeZone());
    if (local !== EVENT_TZ) setZone(local);
    // Once, on mount. A device's zone can change mid-session — a laptop
    // waking up in another state — but catching that would mean a timer on
    // every page, and a reload fixes it.
  }, []);

  return <TimeZoneContext.Provider value={zone}>{children}</TimeZoneContext.Provider>;
}

export function useTimeZone(): string {
  return useContext(TimeZoneContext);
}

/**
 * An instant, rendered for whoever is reading it.
 *
 * Clock styles follow the reader. Date-only styles deliberately do NOT: a
 * session's calendar date is the event's, the same on every screen, and
 * shifting it would show a member on the west coast a different day than
 * the one on their ticket.
 */
export function LocalTime({
  at,
  style = "dateTime",
  className,
  follow,
}: {
  at: string | number | Date;
  style?: TimeStyle;
  className?: string;
  /**
   * Override which zone this follows.
   *
   * Needed where a date sits beside its own time as two separate elements —
   * a session card shows "Sep 12" under one icon and "8:00 PM EDT" under
   * the next. Left to the style alone the date would anchor to the event
   * and the time to the reader, and for a session late enough in the
   * evening the pair would name two different days. Passing
   * follow="viewer" on the date keeps them one instant.
   */
  follow?: "viewer" | "event";
}) {
  const viewer = useTimeZone();
  const follows = follow ?? (showsAClock(style) ? "viewer" : "event");
  const zone = follows === "viewer" ? viewer : EVENT_TZ;
  const iso = toIso(at);

  return (
    <time dateTime={iso ?? undefined} className={className}>
      {formatAt(at, style, zone)}
    </time>
  );
}

function toIso(at: string | number | Date): string | null {
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
