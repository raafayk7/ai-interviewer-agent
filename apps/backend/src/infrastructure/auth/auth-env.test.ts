import { describe, expect, it } from "vitest";
import { authEnvFrom } from "./auth-env.js";

const VALID_SECRET = "a".repeat(32);
const VALID_URL = "https://example.com";

describe("authEnvFrom", () => {
  describe("BETTER_AUTH_SECRET validation", () => {
    it("returns Err when BETTER_AUTH_SECRET is missing", () => {
      const result = authEnvFrom({ BETTER_AUTH_URL: VALID_URL });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().message).toMatch(/BETTER_AUTH_SECRET/);
    });

    it("returns Err when BETTER_AUTH_SECRET is shorter than 32 chars", () => {
      const result = authEnvFrom({
        BETTER_AUTH_SECRET: "tooshort",
        BETTER_AUTH_URL: VALID_URL,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().message).toMatch(/BETTER_AUTH_SECRET/);
    });

    it("returns Err when BETTER_AUTH_SECRET is exactly 31 chars", () => {
      const result = authEnvFrom({
        BETTER_AUTH_SECRET: "a".repeat(31),
        BETTER_AUTH_URL: VALID_URL,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().message).toMatch(/BETTER_AUTH_SECRET/);
    });
  });

  describe("BETTER_AUTH_URL validation", () => {
    it("returns Err when BETTER_AUTH_URL is missing (secret is valid)", () => {
      const result = authEnvFrom({ BETTER_AUTH_SECRET: VALID_SECRET });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().message).toMatch(/BETTER_AUTH_URL/);
    });
  });

  describe("success path", () => {
    it("returns Ok when both secret (>= 32 chars) and URL are present", () => {
      const result = authEnvFrom({
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: VALID_URL,
      });

      expect(result.isOk()).toBe(true);
      const env = result.unwrap();
      expect(env.betterAuthSecret).toBe(VALID_SECRET);
      expect(env.betterAuthUrl).toBe(VALID_URL);
    });

    it("returns Ok when secret is exactly 32 chars", () => {
      const result = authEnvFrom({
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: VALID_URL,
      });

      expect(result.isOk()).toBe(true);
    });

    it("returns Ok when secret is longer than 32 chars", () => {
      const result = authEnvFrom({
        BETTER_AUTH_SECRET: "a".repeat(64),
        BETTER_AUTH_URL: VALID_URL,
      });

      expect(result.isOk()).toBe(true);
    });
  });
});
