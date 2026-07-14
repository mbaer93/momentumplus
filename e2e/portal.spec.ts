import { expect, test } from "@playwright/test";

test.describe("auth + portal shell", () => {
  test("login page renders the Momentum+ brand and preview note", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.locator(".login-logo")).toContainText("Momentum+");
    await expect(page.locator(".login-badge")).toContainText("Members Only");
    // Preview mode banner (no Supabase creds in test env)
    await expect(page.locator(".login-success")).toContainText("Preview mode");
  });

  test("root redirects into the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator(".welcome-text h1")).toContainText("Good morning");
  });

  test("dashboard shows stats, upcoming sessions, and community activity", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".stat-card")).toHaveCount(4);
    await expect(page.locator(".upcoming-item").first()).toBeVisible();
    await expect(page.locator(".activity-item").first()).toBeVisible();
  });

  test("sponsor rail renders on dashboard but not on profile", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".sponsor-rail")).toBeVisible();
    await expect(page.locator(".sponsor-ad-card").first()).toContainText(
      "NewsTalk",
    );
    await page.goto("/profile");
    await expect(page.locator(".sponsor-rail")).toHaveCount(0);
  });

  test("expired page shows the four confirmed pricing plans", async ({
    page,
  }) => {
    await page.goto("/expired");
    await expect(page.locator(".pricing-card")).toHaveCount(4);
    await expect(page.locator(".pricing-best-tag")).toContainText("Best Value");
    await expect(page.getByText("$1,668")).toBeVisible();
    await expect(page.getByText("Save $708")).toBeVisible();
  });
});
