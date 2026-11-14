// "Help me choose": four questions, then a shortlist that carries into the planner.
import { test, expect } from "./fixtures.js";

for (const [button, area] of [["London · West End", "London"], ["New York · Broadway", "New York"]]) {
  test(`helper gives a shortlist for ${area}`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.locator("button.mh-card.mh-feature").click();
    for (const question of ["Who’s coming?", "What kind of night out?", "A classic, or something newer?", "How many shows are you planning to see?"]) {
      await expect(page.locator("#mhTitle")).toHaveText(question);
      await page.locator("button.mh-option").first().click();
    }
    await expect(page.locator("#mhTitle")).toContainText(`Your shortlist for ${area}`);
    const hearts = page.locator("button.mh-heart");
    expect(await hearts.count()).toBeGreaterThanOrEqual(3);
    await hearts.first().click();
    // On to the planner: the choose-dates screen for the same city.
    await page.locator("button.mh-btn.primary").click();
    await expect(page.locator("#continueBtn")).toBeVisible();
  });
}
