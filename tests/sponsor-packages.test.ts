import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPONSOR_PACKAGES_2026,
  defaultTicketCounts,
  packageForTier,
  packagePrice,
} from "../lib/sponsor-packages";
import { SPONSOR_TIERS, sponsorTierRank } from "../lib/sponsor-tiers";

/*
 * The catalog is reference data transcribed from the 2026 sheets — these
 * tests pin the numbers so a future edit that breaks a price or drops a
 * package fails loudly instead of quietly misquoting a sponsor.
 */

const tiers = new Set(SPONSOR_TIERS.map((t) => t.value as string));

test("every package maps to a registered sponsor tier", () => {
  for (const p of SPONSOR_PACKAGES_2026) {
    assert.ok(tiers.has(p.tier), `unknown tier: ${p.tier}`);
  }
});

test("packages are listed in display (hierarchy) order", () => {
  const ranks = SPONSOR_PACKAGES_2026.map((p) => sponsorTierRank(p.tier));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test("2026 sheet prices survive verbatim", () => {
  const price = (tier: string) => packageForTier(tier)?.price;
  assert.equal(price("title"), 15000);
  assert.equal(price("momentum_plus"), 10000);
  assert.equal(price("platinum"), 7500);
  assert.equal(price("lunch"), 6500);
  assert.equal(price("happy_hour"), 6500);
  assert.equal(price("gold"), 5000);
  assert.equal(price("breakfast"), 4000);
  assert.equal(price("silver"), 2500);
  assert.equal(price("coffee_break"), 2500);
  assert.equal(price("event_program"), 2500);
  assert.equal(price("community"), 750);
  assert.equal(price("strategic_media"), 5000);
  assert.equal(price("regional_media"), 2500);
  assert.equal(price("community_media"), 750);
});

test("exclusives and unlimited packages match the sheets", () => {
  const avail = (tier: string) => packageForTier(tier)?.available;
  for (const exclusive of [
    "title",
    "momentum_plus",
    "lunch",
    "happy_hour",
    "breakfast",
    "coffee_break",
    "event_program",
    "strategic_media",
  ]) {
    assert.equal(avail(exclusive), 1, `${exclusive} should be exclusive`);
  }
  assert.equal(avail("platinum"), 2);
  assert.equal(avail("gold"), 3);
  assert.equal(avail("silver"), 3);
  assert.equal(avail("regional_media"), 2);
  assert.equal(avail("community"), null);
  assert.equal(avail("community_media"), null);
});

test("only media partnerships are in-kind; strategic media is sold out", () => {
  for (const p of SPONSOR_PACKAGES_2026) {
    assert.equal(p.inKind, p.tier.endsWith("_media"), p.tier);
  }
  assert.equal(packageForTier("strategic_media")?.soldOut, true);
});

test("packagePrice formats cash vs in-kind", () => {
  assert.equal(packagePrice(packageForTier("lunch")!), "$6,500");
  assert.equal(
    packagePrice(packageForTier("strategic_media")!),
    "$5,000 in-kind",
  );
});

test("ticket defaults mirror the sheets' VIP counts", () => {
  const counts = defaultTicketCounts();
  assert.equal(counts.title, 10);
  assert.equal(counts.momentum_plus, 2);
  assert.equal(counts.platinum, 5);
  assert.equal(counts.lunch, 3);
  assert.equal(counts.happy_hour, 3);
  assert.equal(counts.gold, 5);
  assert.equal(counts.community, 1);
  assert.equal(counts.strategic_media, 5);
});

test("unknown tier has no package", () => {
  assert.equal(packageForTier("host"), null);
  assert.equal(packageForTier("partner"), null);
});
