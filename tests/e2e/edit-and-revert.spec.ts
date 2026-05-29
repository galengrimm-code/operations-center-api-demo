import { test, expect } from "@playwright/test";

// Exercises the product-line edit + revert flow against whatever application
// data exists for the authenticated user (seed data locally, real JD data on a
// connected account). Verifies the mutation path: edit a rate -> "edited" badge
// + Revert appear -> revert -> badge clears.
test.describe("Edit + revert product line", () => {
  test("user edits a rate, sees edited badge, reverts to JD original", async ({ page }) => {
    await page.goto("/applications");

    // Expand the first application (row button label includes "N items").
    const appRow = page.getByRole("button", { name: /items/ }).first();
    await appRow.click();

    // Open the edit dialog on the first product line.
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: /^Edit / })).toBeVisible();

    // Rate is the first numeric input. Bump it by 1.
    const rateInput = page.locator('input[type="number"]').first();
    const original = await rateInput.inputValue();
    const newRate = (Number(original) + 1).toString();
    await rateInput.fill(newRate);

    await page.getByRole("button", { name: "Save" }).click();

    // Dialog closes.
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0, {
      timeout: 10_000,
    });

    // Edited badge + Revert button appear after the refetch.
    await expect(page.getByText("edited").first()).toBeVisible();
    const revertBtn = page.getByRole("button", { name: "Revert", exact: true }).first();
    await expect(revertBtn).toBeVisible();

    // Revert restores the JD original; the edited badge clears.
    await revertBtn.click();
    await expect(page.getByText("edited")).toHaveCount(0, { timeout: 10_000 });
  });
});
