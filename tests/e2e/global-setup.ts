import * as dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

import { chromium, FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use?.baseURL ?? "http://localhost:3000";
  const email = process.env.PLAYWRIGHT_TEST_EMAIL;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD must be set in .env.test");
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(map|applications|products)/, { timeout: 30_000 });
  await page.context().storageState({ path: "tests/e2e/.auth/state.json" });
  await browser.close();
}
