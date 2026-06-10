import { test, expect } from "@playwright/test";

// Seed prices are set for the seed-org "Burndown - North 80" application (2025):
//   32% UAN  $3.50/gal  -> 800 gal / 80 ac  = $35.00/ac
//   AMS      $400/ton   -> 1360 lb / 80 ac  = $3.40/ac
//   Liberty 280 SL (unit "oz", unrecognized) -> unpriced "—"
//   Application total: $38.40/ac
test("pricing flows to per-line and application $/ac on the applications view", async ({
  page,
}) => {
  await page.goto("/applications");
  await page.waitForLoadState("networkidle");

  // Header shows the application total $/ac (sum of priced lines; unpriced excluded)
  await expect(page.getByText("$38.40/ac")).toBeVisible();

  // Expand the application to reveal per-line cost
  await page
    .getByText(/Burndown/i)
    .first()
    .click();

  // UAN line: $35.00/ac · $3.50/gal
  await expect(page.getByText("$35.00/ac").first()).toBeVisible();
  // AMS line: $3.40/ac · $400.00/ton (weight->ton conversion)
  await expect(page.getByText("$3.40/ac").first()).toBeVisible();
});

test("products page exposes per-year price entry", async ({ page }) => {
  await page.goto("/products");
  await page.waitForLoadState("networkidle");

  // Pricing year selector + the Price/Density columns exist
  await expect(page.getByText("Prices:")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Price/i })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Density/i })).toBeVisible();
});
