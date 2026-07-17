import * as React from "react";

/*
 * Per-request memoization. React.cache dedupes calls within one RSC render
 * (layout + page share one execution), but it only exists in the React
 * server runtime — plain Node (unit tests, scripts) gets the client build
 * where it's undefined. Fall back to identity there: tests then exercise
 * the raw function, which is exactly what they want anyway.
 */
type AnyFn = (...args: never[]) => unknown;

export const requestCache: <F extends AnyFn>(fn: F) => F =
  (React as { cache?: <F extends AnyFn>(fn: F) => F }).cache ??
  ((fn) => fn);
