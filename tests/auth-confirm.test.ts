import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../app/auth/confirm/route";

/*
 * The emailed-link landing page.
 *
 * Every link in an invite or reset email is fetched by corporate mail
 * security before the member ever sees it, and these tokens are one-time.
 * The whole design of this route is that a GET renders a page and only a
 * POST verifies — so a scanner's fetch cannot burn the token.
 *
 * That protection was silently undone once already: an auto-submit script
 * added on 2026-08-05 inside an unrelated PR. Defender Safe Links and
 * Proofpoint run JavaScript, so they submitted the form, consumed the
 * token, and the member got "that link has expired or was already used" on
 * a link they had never opened. It cost a speaker two days and two support
 * emails. These tests exist so it cannot come back a third time.
 */

async function landingPage(query: string): Promise<string> {
  const res = await GET(
    new NextRequest(`https://momentumplus.co/auth/confirm?${query}`),
  );
  return res.text();
}

test("the landing page never submits itself", async () => {
  const html = await landingPage("token_hash=abc123&type=recovery");
  /*
   * The precise failure: any script that submits the form turns a scanner's
   * automated fetch into a real verification. Checked broadly — .submit(),
   * requestSubmit(), a click() on the button, or a meta refresh would each
   * do it.
   */
  assert.ok(!/\.submit\(\)/.test(html), "auto-submit would let a scanner spend the token");
  assert.ok(!/requestSubmit/.test(html));
  assert.ok(!/\.click\(\)/.test(html));
  assert.ok(!/http-equiv=["']?refresh/i.test(html));
});

test("the page still gives the member a way through", async () => {
  // Removing the auto-submit is only safe because a real button remains.
  const html = await landingPage("token_hash=abc123&type=invite");
  assert.match(html, /<form method="POST" action="\/auth\/confirm"/);
  assert.match(html, /type="submit"/);
  assert.match(html, /Continue to sign in/);
});

test("the token is carried to the POST, not verified on the GET", async () => {
  const html = await landingPage("token_hash=tok_xyz&type=recovery&redirect=/welcome");
  assert.match(html, /name="token_hash" value="tok_xyz"/);
  assert.match(html, /name="type" value="recovery"/);
  assert.match(html, /name="redirect" value="\/welcome"/);
});

test("values from the URL are escaped into the form", async () => {
  // These land in HTML attributes straight from a query string.
  const html = await landingPage(
    `token_hash=${encodeURIComponent('"><script>alert(1)</script>')}&type=recovery`,
  );
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
});

test("an off-site redirect is not honoured", async () => {
  // The form's redirect is replayed after verification; an outside host
  // would make this a way to bounce a freshly signed-in member anywhere.
  const html = await landingPage(
    `token_hash=abc&type=recovery&redirect=${encodeURIComponent("//evil.example.com")}`,
  );
  assert.match(html, /name="redirect" value="\/welcome"/);
});

test("a link with no token goes to sign-in rather than rendering a form", async () => {
  const res = await GET(new NextRequest("https://momentumplus.co/auth/confirm"));
  assert.equal(res.status, 307);
  assert.match(res.headers.get("location") ?? "", /\/login$/);
});

test("the page is never cached", async () => {
  // A cached one-time-token page is a token sitting in a shared proxy.
  const res = await GET(
    new NextRequest("https://momentumplus.co/auth/confirm?token_hash=abc&type=recovery"),
  );
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
});
