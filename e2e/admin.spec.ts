import { expect, test } from "@playwright/test";

test.describe("admin portal (preview mode)", () => {
  test("admin hub shows stats and section cards", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.locator(".admin-stat-card")).toHaveCount(4);
    await expect(page.getByRole("link", { name: /Members/ })).toBeVisible();
  });

  test("session management table lists sessions with actions", async ({
    page,
  }) => {
    await page.goto("/admin/sessions");
    const rows = page.locator(".admin-table tbody tr");
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
    await expect(rows.first().getByRole("link", { name: "Edit" })).toBeVisible();
  });

  test("new session form renders all fields", async ({ page }) => {
    await page.goto("/admin/sessions/new");
    for (const label of ["Title", "Description", "Category", "Status", "Starts at", "Access level"]) {
      await expect(page.getByLabel(label)).toBeVisible();
    }
  });

  test("members page shows the grant form and member rows", async ({
    page,
  }) => {
    await page.goto("/admin/members");
    await expect(page.getByLabel(/Grant membership/)).toBeVisible();
    expect(await page.locator(".admin-table tbody tr").count()).toBeGreaterThan(0);
  });

  test("announcement composer requires audience + channels", async ({
    page,
  }) => {
    await page.goto("/admin/announcements");
    await expect(page.getByLabel("Title")).toBeVisible();
    // Deselect all tiers → send disabled.
    const chips = page.locator(".tier-chip.selected");
    const count = await chips.count();
    for (let i = 0; i < count; i++) {
      await page.locator(".tier-chip.selected").first().click();
    }
    await expect(
      page.getByRole("button", { name: "Send announcement" }),
    ).toBeDisabled();
  });
});
