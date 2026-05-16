import { expect, test, type Page, type Route } from "@playwright/test";

const SIGN_UP_ROUTE = "**/api/auth/sign-up/email";

async function stubSignUp(
  page: Page,
  body: { status: number; payload: Record<string, unknown> },
): Promise<void> {
  await page.route(SIGN_UP_ROUTE, async (route: Route) => {
    await route.fulfill({
      status: body.status,
      contentType: "application/json",
      body: JSON.stringify(body.payload),
    });
  });
}

test.describe("Signup form", () => {
  test("renders the form fields", async ({ page }) => {
    await page.goto("/signup");
    await expect(
      page.getByText("Enter your email to get started with Sift."),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  test("shows a field error on invalid email", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("longenough");
    await page.getByLabel("Confirm password").fill("longenough");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Enter a valid email")).toBeVisible();
  });

  test("shows a field error when password is too short", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Password must be at least 8 characters")).toBeVisible();
  });

  test("shows a field error when confirm password does not match", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password", { exact: true }).fill("longenough");
    await page.getByLabel("Confirm password").fill("differentEnough");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Passwords do not match")).toBeVisible();
  });

  test("maps USER_ALREADY_EXISTS to non-enumerating neutral copy", async ({ page }) => {
    await stubSignUp(page, {
      status: 409,
      payload: { code: "USER_ALREADY_EXISTS", message: "User already exists" },
    });

    await page.goto("/signup");
    await page.getByLabel("Email").fill("taken@example.com");
    await page.getByLabel("Password", { exact: true }).fill("longenough");
    await page.getByLabel("Confirm password").fill("longenough");
    await page.getByRole("button", { name: "Create account" }).click();

    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(
      "We couldn't create your account. If you already have one, sign in instead.",
    );
    // Regression guard: must NOT leak existence-confirming language.
    await expect(alert).not.toContainText(/already exists/i);
  });

  test("maps any other error code to the generic fallback", async ({ page }) => {
    await stubSignUp(page, {
      status: 500,
      payload: { code: "INTERNAL_SERVER_ERROR", message: "boom" },
    });

    await page.goto("/signup");
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password", { exact: true }).fill("longenough");
    await page.getByLabel("Confirm password").fill("longenough");
    await page.getByRole("button", { name: "Create account" }).click();

    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText("Something went wrong. Try again in a moment.");
  });

  test('clicking "Sign in" link navigates to /login', async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
