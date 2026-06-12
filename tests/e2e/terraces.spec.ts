import { expect, test } from "@playwright/test";

// Smoke test: the Terraces page renders behind auth without crashing.
// Full data flow (field with imported terrace lines + map editing) needs
// Galen's John Deere connection, which the test account lacks — verified
// manually against Home Place.
test.describe("Terraces page", () => {
  test("renders controls and nav entry", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto("/terraces");

    await expect(page.getByRole("heading", { name: "Terraces" })).toBeVisible();
    await expect(page.getByText("Field", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Terraces" })).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });
});
