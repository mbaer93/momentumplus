import { test, expect } from "@playwright/test";

/*
 * The speaker onboarding gate (Matt, 2026-08-12).
 *
 * A test speaker reached the Studio, a public directory page, and
 * Pro-equivalent portal access having entered nothing but a name: the form
 * marked one field required and the server checked one field.
 *
 * Two layers, tested separately on purpose. The browser's `required`
 * attributes are a convenience — pleasant, and trivially removed from
 * devtools. The server check is the gate. A test that only clicks Submit
 * proves the convenience works and says nothing about the gate, so the
 * second test strips the attributes exactly as a determined user would.
 */

const FIELDS = {
  "#sk-first": "Jane",
  "#sk-last": "Rivers",
  "#sk-title": "Leadership Coach",
  "#sk-bio": "Twenty years leading teams through change.",
  "#sk-industries": "Leadership, Wellness",
  "#sk-biz": "Rivers Coaching",
  "#sk-biz-desc": "Executive coaching for newly promoted managers.",
  "#sk-biz-url": "https://rivers.example",
  "#sk-phone": "+1 555 555 5555",
};

test.beforeEach(async ({ page }) => {
  await page.goto("/speaker-onboarding");
});

test("every field the gate requires is marked required in the form", async ({
  page,
}) => {
  // Each of these was optional, which is how an empty speaker page shipped.
  for (const selector of Object.keys(FIELDS)) {
    await expect(page.locator(selector)).toHaveAttribute("required", "");
  }
});

test("the business fields are visible without typing a business name first", async ({
  page,
}) => {
  // They used to render only once a business name was entered. Harmless
  // while optional; once required it is a form you cannot submit and cannot
  // see why.
  await expect(page.locator("#sk-biz-desc")).toBeVisible();
  await expect(page.locator("#sk-biz-url")).toBeVisible();
});

test("submitting an empty form does not reach the server", async ({ page }) => {
  await page.locator('button[type="submit"]').click();
  // Still on the form, nothing submitted: the browser stopped it.
  await expect(page.locator("#sk-first")).toBeVisible();
  const valid = await page
    .locator("#sk-first")
    .evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(valid).toBe(false);
});

test("the SERVER rejects an incomplete form when the attributes are stripped", async ({
  page,
}) => {
  await page.fill("#sk-first", "Jane");
  await page.fill("#sk-last", "Rivers");
  // The password step runs first in the submit handler and returns early, so
  // an unfilled password would hide the thing under test behind a password
  // error. Satisfy it, then leave the profile fields empty.
  const password = page.locator("#sk-password");
  if (await password.count()) {
    await password.fill("TestPass123!");
    await page.locator("#sk-confirm").fill("TestPass123!");
  }
  // Strip AFTER filling: these are controlled inputs, so every keystroke
  // re-renders and would restore an attribute removed earlier. This is
  // exactly what bypassing client validation looks like.
  await page.evaluate(() => {
    document
      .querySelectorAll("[required]")
      .forEach((el) => el.removeAttribute("required"));
  });
  await page.locator('button[type="submit"]').click();

  // Named fields, not a generic "invalid" — the speaker has to know what to
  // add. Bio is one of the seven that was optional before.
  await expect(page.getByText(/Please add/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/your bio/i)).toBeVisible();
});

test("a fully completed form is accepted", async ({ page }) => {
  for (const [selector, value] of Object.entries(FIELDS)) {
    await page.fill(selector, value);
  }
  const password = page.locator("#sk-password");
  if (await password.count()) {
    await password.fill("TestPass123!");
    await page.locator("#sk-confirm").fill("TestPass123!");
  }
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/Please add/i)).toHaveCount(0);

  // A completed setup ends on the thank-you and orientation screen, not a
  // silent redirect into a tool the speaker has never seen (Matt,
  // 2026-08-14). Assert the orientation is actually there, not just that
  // the gate passed.
  await expect(page.getByText(/Thank you/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Speaker Studio/i).first()).toBeVisible();
  await expect(page.getByText(/Leadership Advisor Agreement/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Open your Speaker Studio/i }),
  ).toBeVisible();
});
