import { expect, test } from "@playwright/test";

// A valid UUID format is required for the route to match; the value itself
// does not matter — the backend is not running during this spec.
const FAKE_ID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// Self-hermetic: no backend dependency.
//
// "invalid-link" path — short-circuits in loadCandidateView before any fetch:
//   if (!token) return { kind: "invalid-link" }
//
// "network" path — NEXT_PUBLIC_API_URL points at localhost:3002 (from
//   apps/web/.env.local) which is NOT running during E2E; the server-side
//   fetch in loadCandidateView throws ECONNREFUSED and returns
//   { kind: "network", ... }, which the page maps to CandidateErrorScreen
//   kind="network".
// ---------------------------------------------------------------------------

test.describe("Candidate error states", () => {
  test("renders invalid-link copy when token query param is absent", async ({
    page,
  }) => {
    await page.goto(`/c/${FAKE_ID}`);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "This link doesn't look right.",
      }),
    ).toBeVisible();

    await expect(
      page.getByText(
        /check the link your recruiter sent/i,
      ),
    ).toBeVisible();
  });

  test("renders network-error copy when the backend is unreachable", async ({
    page,
  }) => {
    // The token is syntactically present so loadCandidateView proceeds to
    // fetch; the request fails because localhost:3002 is not listening.
    await page.goto(`/c/${FAKE_ID}?token=hermetic-test-token`);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "We can't reach Sift right now.",
      }),
    ).toBeVisible();

    await expect(
      page.getByText(/check your connection/i),
    ).toBeVisible();
  });
});
