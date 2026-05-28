import { test, expect } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  // Redirects to /login or /map depending on auth state — either is fine for sanity.
  await expect(page).toHaveURL(/\/(login|map)/);
});
