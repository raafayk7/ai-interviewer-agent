import { expect, test, type Page, type Route } from "@playwright/test";

const SIGN_IN_ROUTE = "**/api/auth/sign-in/email";

async function stubSignIn(
  page: Page,
  body: { status: number; payload: Record<string, unknown> },
): Promise<void> {
  await page.route(SIGN_IN_ROUTE, async (route: Route) => {
    await route.fulfill({
      status: body.status,
      contentType: "application/json",
      body: JSON.stringify(body.payload),
    });
  });
}

test.describe("Login form", () => {
  test("renders the form fields", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Sign in", level: 3 }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  test("shows a field error on invalid email", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("anypassword");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Enter a valid email")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  });

  test("shows a field error when password is empty", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Password required")).toBeVisible();
  });

  test("maps INVALID_EMAIL_OR_PASSWORD to user-facing copy", async ({ page }) => {
    await stubSignIn(page, {
      status: 401,
      payload: {
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      },
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password").fill("wrongpass");
    await page.getByRole("button", { name: "Sign in" }).click();

    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText("Email or password is incorrect.");
  });

  test("maps any other error code to the generic fallback", async ({ page }) => {
    await stubSignIn(page, {
      status: 500,
      payload: { code: "INTERNAL_SERVER_ERROR", message: "boom" },
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password").fill("somepassword");
    await page.getByRole("button", { name: "Sign in" }).click();

    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText("Something went wrong. Try again in a moment.");
  });

  test('clicking "Create an account" link navigates to /signup', async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup$/);
  });
});
