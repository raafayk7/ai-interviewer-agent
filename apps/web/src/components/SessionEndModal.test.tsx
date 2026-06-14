import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SessionEndModal, type SessionEndVariant } from "./SessionEndModal";

const EXPECTED_COPY: Record<
  SessionEndVariant,
  { title: RegExp; description: RegExp }
> = {
  completed: {
    title: /interview complete/i,
    description:
      /thank you — your interview has finished\. you can close this tab; there is nothing more to do\./i,
  },
  blocked: {
    title: /this interview is no longer available/i,
    description:
      /this interview is already in progress in another session, or has already finished\. you can close this tab\./i,
  },
};

describe("SessionEndModal", () => {
  for (const variant of ["completed", "blocked"] as const) {
    it(`renders calm end-of-session copy for "${variant}"`, () => {
      render(<SessionEndModal variant={variant} />);

      expect(
        screen.getByRole("dialog", { name: EXPECTED_COPY[variant].title }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(EXPECTED_COPY[variant].description),
      ).toBeInTheDocument();
    });
  }

  it("does not render a close button or action button", () => {
    render(<SessionEndModal variant="completed" />);

    expect(
      screen.queryByRole("button", { name: /close/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not dismiss when Escape is pressed", async () => {
    const user = userEvent.setup();
    render(<SessionEndModal variant="blocked" />);

    await user.keyboard("{Escape}");

    expect(
      screen.getByRole("dialog", {
        name: EXPECTED_COPY.blocked.title,
      }),
    ).toBeInTheDocument();
  });
});
