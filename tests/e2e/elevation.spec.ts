import { expect, test } from "@playwright/test";

// Smoke test: the Elevation page renders behind auth without crashing.
// Full data flow (JD shapefile pull + merge) needs a real John Deere
// connection, which the test account doesn't have — verified manually.
test.describe("Elevation page", () => {
  test("renders controls and nav entry", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto("/elevation");

    await expect(page.getByRole("heading", { name: "Elevation" })).toBeVisible();
    await expect(page.getByRole("button", { name: /build elevation map/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /build elevation map/i })).toBeDisabled();
    await expect(page.getByText("Contour interval")).toBeVisible();

    // Nav link present and active styling reachable
    await expect(page.getByRole("link", { name: "Elevation" })).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });
});
