import assert from "node:assert/strict";
import { test } from "node:test";
import { ticketsUsed, type SponsorSeat } from "../lib/sponsor-team";

/*
 * VIP ticket consumption. This number is what stands between a sponsor and
 * handing out more comped memberships than their tier bought — get it wrong
 * downwards and Momentum+ gives away paid access.
 */

function seat(over: Partial<SponsorSeat> = {}): SponsorSeat {
  return {
    profileId: "p1",
    name: "Person",
    email: "p@example.com",
    role: "member",
    regularMember: false,
    vipTicket: false,
    ...over,
  };
}

test("only seats holding a VIP-ticket comp count against the allotment", () => {
  const team: SponsorSeat[] = [
    seat({ profileId: "a", vipTicket: true }),
    seat({ profileId: "b", vipTicket: true }),
    seat({ profileId: "c" }),
  ];
  assert.equal(ticketsUsed(team), 2);
});

test("co-managers who pay for themselves never consume a ticket", () => {
  // regularMember means an active membership NOT comped through the
  // sponsorship — it is the co-manager eligibility bar, not consumption.
  const team: SponsorSeat[] = [
    seat({ profileId: "a", role: "manager", regularMember: true }),
    seat({ profileId: "b", role: "owner", regularMember: true }),
  ];
  assert.equal(ticketsUsed(team), 0);
});

test("a lapsed ticket still counts — consumption is permanent", () => {
  /* Matt, 2026-07-20: every seat that ever received a VIP-ticket comp
     counts, active or lapsed. Freeing a ticket by letting it expire would
     let one sponsorship be spent repeatedly. The seat carries vipTicket
     either way, so the count must not be conditioned on anything else. */
  const team: SponsorSeat[] = [
    seat({ profileId: "a", vipTicket: true, regularMember: false }),
    seat({ profileId: "b", vipTicket: true, regularMember: true }),
  ];
  assert.equal(ticketsUsed(team), 2);
});

test("an empty team has consumed nothing", () => {
  assert.equal(ticketsUsed([]), 0);
});

test("a manager who also took a ticket still consumes it", () => {
  // Role and consumption are independent: being promoted to manager must
  // not silently refund the ticket the seat was created with.
  const team: SponsorSeat[] = [
    seat({ profileId: "a", role: "manager", vipTicket: true }),
  ];
  assert.equal(ticketsUsed(team), 1);
});
