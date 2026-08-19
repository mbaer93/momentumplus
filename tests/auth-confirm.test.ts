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

/*
 * The /auth/callback fragment fallback (2026-08-19 audit).
 *
 * Which shape an emailed link arrives in depends on a Supabase email
 * template that lives outside this repo. The implicit flow puts the whole
 * session in the URL FRAGMENT — which is never sent to the server — so a
 * route that only reads the query string sees an empty request, calls the
 * link mangled, and throws away a working session. On go-live that would
 * be every member at once, from a template change nobody made in code.
 */

async function callbackPage(query: string): Promise<Response> {
  const { GET } = await import("../app/auth/callback/route");
  return GET(new NextRequest(`https://momentumplus.co/auth/callback?${query}`));
}

test("a link with no code hands off to the browser instead of dying", async () => {
  const res = await callbackPage("redirect=/welcome");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /location\.hash/);
  assert.match(html, /access_token/);
  assert.match(html, /refresh_token/);
});

test("the handoff carries the redirect through", async () => {
  const html = await (await callbackPage("redirect=/welcome")).text();
  assert.match(html, /name="redirect" value="\/welcome"/);
});

test("an off-site redirect is refused before it reaches the form", async () => {
  const html = await (
    await callbackPage(`redirect=${encodeURIComponent("//evil.example.com")}`)
  ).text();
  assert.match(html, /name="redirect" value="\/dashboard"/);
  assert.ok(!html.includes("evil.example.com"));
});

test("a recovery link that fails falls back to the reset form, not sign-in", async () => {
  // Sending someone to a password box answers "invalid login credentials",
  // which reads as "your password is wrong" and restarts the loop.
  const html = await (await callbackPage("redirect=/welcome%3Fmode=reset")).text();
  assert.match(html, /\/reset\?error=/);
  assert.ok(!/\/login\?error=/.test(html));
});

test("the page works without JavaScript, and never caches", async () => {
  const res = await callbackPage("redirect=/welcome");
  const html = await res.text();
  // A scanner or a JS-less browser must still be told what to do.
  assert.match(html, /<noscript>/);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
});

test("a scanner fetching the bare URL submits nothing", async () => {
  /*
   * The script only submits when a fragment actually carries tokens, and a
   * scanner's fetch has no fragment — so unlike the auto-submit that broke
   * /auth/confirm, this one cannot spend anything.
   */
  const html = await (await callbackPage("redirect=/welcome")).text();
  assert.match(html, /if \(at && rt\)/);
});
