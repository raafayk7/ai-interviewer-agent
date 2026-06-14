import { describe, expect, it } from "vitest";
import { corsEnvFrom } from "./cors-env.js";

describe("corsEnvFrom", () => {
  it("defaults to ['http://localhost:3000'] when absent outside production", () => {
    const result = corsEnvFrom({});

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().origins).toEqual(["http://localhost:3000"]);
  });

  it("returns Err when absent in production", () => {
    const result = corsEnvFrom({ NODE_ENV: "production" });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/CORS_ALLOWED_ORIGINS/);
  });

  it("parses a single origin", () => {
    const result = corsEnvFrom({
      CORS_ALLOWED_ORIGINS: "https://app.example.com",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().origins).toEqual(["https://app.example.com"]);
  });

  it("parses comma-separated origins and trims whitespace", () => {
    const result = corsEnvFrom({
      CORS_ALLOWED_ORIGINS: "https://a.example.com, https://b.example.com ,https://c.example.com",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().origins).toEqual([
      "https://a.example.com",
      "https://b.example.com",
      "https://c.example.com",
    ]);
  });

  it("returns Err when value contains only commas/whitespace", () => {
    const result = corsEnvFrom({
      CORS_ALLOWED_ORIGINS: " , , ",
      NODE_ENV: "production",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/CORS_ALLOWED_ORIGINS/);
  });
});
