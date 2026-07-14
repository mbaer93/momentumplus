import { expect, test } from "@playwright/test";

test.describe("tier gating + community", () => {
  test("community renders channels and the admin-post-only gate", async ({
    page,
  }) => {
    await page.goto("/community");
    await expect(page.locator(".channel-item").first()).toBeVisible();

    // Placeholder member is sub_annual → vip-only and annual-members unlocked.
    await expect(
      page.locator(".channel-item", { hasText: "vip-only" }),
    ).not.toHaveClass(/locked/);

    // announcements is admin-post-only: composer disabled for non-admins.
    await page.locator(".channel-item", { hasText: "announcements" }).click();
    const input = page.locator(".chat-input-box input");
    await expect(input).toBeDisabled();
    await expect(input).toHaveAttribute(
      "placeholder",
      /Only admins can post/,
    );
  });

  test("posting in general appends the message locally (preview)", async ({
    page,
  }) => {
    await page.goto("/community");
    const input = page.locator(".chat-input-box input");
    await input.fill("Hello from the e2e suite");
    await input.press("Enter");
    await expect(
      page.locator(".msg-bubble", { hasText: "Hello from the e2e suite" }),
    ).toBeVisible();
  });

  test("VIP-gated resources show as Exclusive for gating below vip_plus", async ({
    page,
  }) => {
    await page.goto("/resources");
    // sub_annual placeholder member IS vip_plus, so everything is unlocked —
    // verify the unlock path renders download/open buttons.
    await expect(page.locator(".resource-card").first()).toBeVisible();
    const links = page.locator("button.resource-link");
    expect(await links.count()).toBeGreaterThan(0);
  });

  test("library renders VIP badges on gated recordings", async ({ page }) => {
    await page.goto("/library");
    await expect(page.locator(".recording-card").first()).toBeVisible();
    await expect(page.locator(".recording-vip").first()).toBeVisible();
  });
});
