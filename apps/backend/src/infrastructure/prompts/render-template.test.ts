import { describe, expect, it } from "vitest";

import { renderTemplate } from "./render-template.js";

describe("renderTemplate", () => {
  it("renders Langfuse-style double-brace variables", () => {
    const rendered = renderTemplate("Hello {{name}} from {{company}}.", {
      name: "Ada",
      company: "CarbonTeq",
    });

    expect(rendered).toBe("Hello Ada from CarbonTeq.");
  });

  it("replaces every occurrence of a variable and leaves unknown variables intact", () => {
    const rendered = renderTemplate("{{word}} {{word}} {{missing}}", {
      word: "echo",
    });

    expect(rendered).toBe("echo echo {{missing}}");
  });
});
