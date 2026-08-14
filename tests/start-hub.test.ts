import test from "node:test";
import assert from "node:assert/strict";
import {
  START_HUB_DEFAULTS,
  ticketsUrl,
  tslsStartUrl,
} from "../lib/start-hub";

/*
 * The /start hub's outbound links.
 *
 * Both ticket buttons used to be <Link href="/tickets">, which resolves
 * against momentumplus.co — a route that has never existed. Two live buy
 * buttons, 404 on click, on the public page, unnoticed because /start was
 * also the one route the contrast audit silently skipped (Matt,
 * 2026-08-14). Ticket sales live in the TSLS app, so the link leaves this
 * domain by construction.
 */

test("the ticket link defaults to the TSLS app, never a local path", () => {
  const href = ticketsUrl(START_HUB_DEFAULTS);
  assert.ok(href.startsWith("https://"), `${href} must be absolute`);
  assert.ok(!href.startsWith("/"), "a relative link would 404 on this domain");
  assert.match(href, /\/tickets$/);
});

test("an admin override wins", () => {
  assert.equal(
    ticketsUrl({ ticketsUrl: "https://tickets.example/summit-2027" }),
    "https://tickets.example/summit-2027",
  );
});

test("a blank or whitespace override falls back rather than emptying the link", () => {
  // An empty href renders a button that reloads the current page — the
  // failure looks like "nothing happens", which is harder to report than a
  // 404 and just as broken.
  assert.match(ticketsUrl({ ticketsUrl: "   " }), /^https:\/\/.+\/tickets$/);
});

test("the app button points at the TSLS front door", () => {
  assert.match(tslsStartUrl(), /^https:\/\/.+\/start$/);
});
