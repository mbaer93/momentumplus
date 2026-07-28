import { expect, test } from "@playwright/test";

/*
 * Education and the completion certificate.
 *
 * Two things here carry consequences past a wrong pixel: the CE hours a
 * member may submit for professional credit, and whether a certificate can
 * be reached before the course is finished. Neither was covered.
 *
 * Preview mode ships a placeholder course with 1 of 4 lessons done and no
 * test on any lesson — which is exactly the pair of edge cases worth pinning:
 * incomplete, and capped.
 */

test.describe("education", () => {
  test("the course list shows courses and marks the gated one", async ({ page }) => {
    await page.goto("/education");
    await expect(page.getByRole("heading", { name: "Grow on the Go" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /The Resilient Leader Track/ }),
    ).toBeVisible();
    // Revenue Mastery is pro_only; the preview member is an Annual Member,
    // so it must be badged rather than silently opened.
    await expect(
      page.getByRole("link", { name: /EXCLUSIVE.*Revenue Mastery/ }),
    ).toBeVisible();
  });

  test("a course states the CE hours it will actually award", async ({ page }) => {
    /* The placeholder course is worth 3 CE hours but has no test on any
       lesson, so effectiveCeHours caps it at 0.5 — full credit requires
       passing a test at 75%+. This asserts the member is told the capped
       number, not the headline one. */
    await page.goto("/education/resilient-leader");
    await expect(
      page.getByRole("heading", { name: "The Resilient Leader Track" }),
    ).toBeVisible();
    await expect(
      page.getByText("0.5 educational hours on your certificate"),
    ).toBeVisible();
  });

  test("progress is reported against the real lesson count", async ({ page }) => {
    await page.goto("/education/resilient-leader");
    await expect(page.getByText("1 of 4 lessons completed")).toBeVisible();
  });

  test("the certificate is unreachable until every lesson is complete", async ({
    page,
  }) => {
    /* 1 of 4 done, so this must bounce back to the course rather than issue
       anything. A certificate handed out early is a credit claim the member
       cannot substantiate. */
    await page.goto("/education/resilient-leader/certificate");
    await expect(page).toHaveURL(/\/education\/resilient-leader$/);
  });
});
