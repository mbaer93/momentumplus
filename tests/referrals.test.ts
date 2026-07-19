import { strict as assert } from "node:assert";
import test from "node:test";
import { oneMonthAmount } from "@/lib/referrals";

test("oneMonthAmount credits one month, never the whole term", () => {
  // A monthly plan: the whole price IS one month.
  assert.equal(oneMonthAmount(19800, { interval: "month", interval_count: 1 }), 19800);
  // Annual plan billed yearly: one month is a twelfth.
  assert.equal(oneMonthAmount(166800, { interval: "year", interval_count: 1 }), 13900);
  // A 3-month term billed as interval=month count=3.
  assert.equal(oneMonthAmount(53400, { interval: "month", interval_count: 3 }), 17800);
  // Missing recurring info falls back to treating it as one month.
  assert.equal(oneMonthAmount(19800, null), 19800);
  assert.equal(oneMonthAmount(19800, undefined), 19800);
});
