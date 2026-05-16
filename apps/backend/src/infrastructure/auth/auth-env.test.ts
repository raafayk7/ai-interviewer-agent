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

  describe("BETTER_AUTH_TRUSTED_ORIGINS validation", () => {
    it("defaults to ['http://localhost:3000'] when absent outside production", () => {
      const result = authEnvFrom({
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: VALID_URL,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().trustedOrigins).toEqual(["http://localhost:3000"]);
    });

    it("returns Err when absent in production", () => {
      const result = authEnvFrom({
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: VALID_URL,
        NODE_ENV: "production",
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().message).toMatch(/BETTER_AUTH_TRUSTED_ORIGINS/);
    });

    it("parses a single origin", () => {
      const result = authEnvFrom({
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: VALID_URL,
        BETTER_AUTH_TRUSTED_ORIGINS: "https://app.example.com",
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().trustedOrigins).toEqual(["https://app.example.com"]);
    });

    it("parses comma-separated origins and trims whitespace", () => {
      const result = authEnvFrom({
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: VALID_URL,
        BETTER_AUTH_TRUSTED_ORIGINS: "https://a.example.com, https://b.example.com ,https://c.example.com",
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().trustedOrigins).toEqual([
        "https://a.example.com",
        "https://b.example.com",
        "https://c.example.com",
      ]);
    });

    it("returns Err when the value contains only commas/whitespace in production", () => {
      const result = authEnvFrom({
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: VALID_URL,
        BETTER_AUTH_TRUSTED_ORIGINS: " , , ",
        NODE_ENV: "production",
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().message).toMatch(/BETTER_AUTH_TRUSTED_ORIGINS/);
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
