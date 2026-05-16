import { expect, test } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders the Sift hero and both auth CTAs when anonymous", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Sift" })).toBeVisible();
    await expect(
      page.getByText(
        "A composed voice interviewer that listens carefully and reports plainly.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test('clicking "Sign in" navigates to /login', async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText("Welcome back. Enter your credentials to continue."),
    ).toBeVisible();
  });

  test('clicking "Create an account" navigates to /signup', async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(
      page.getByText("Enter your email to get started with Sift."),
    ).toBeVisible();
  });
});
