import { describe, expect, it } from "vitest";
import {
  CandidateSignedLink,
  candidateSignedLinkFromEnv,
} from "./candidate-signed-link.js";
import { InvalidCandidateTokenError } from "@repo/application";

// A secret that satisfies the >= 32 char requirement
const VALID_SECRET = "a".repeat(32);

const makeLink = (secret = VALID_SECRET, ttlSeconds = 3600): CandidateSignedLink =>
  new CandidateSignedLink({ secret, defaultTtlSeconds: ttlSeconds });

describe("CandidateSignedLink", () => {
  describe("issue() then verify()", () => {
    it("returns Ok with the same interviewId on a valid token", () => {
      const link = makeLink();
      const token = link.issue("interview-abc");

      const result = link.verify(token);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().interviewId).toBe("interview-abc");
    });

    it("preserves the interviewId exactly (no truncation or mutation)", () => {
      const link = makeLink();
      const interviewId = "11111111-2222-3333-4444-555555555555";
      const token = link.issue(interviewId);

      const result = link.verify(token);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().interviewId).toBe(interviewId);
    });
  });

  describe("verify() — error paths", () => {
    it("returns InvalidCandidateTokenError when the wrong secret is used to verify", () => {
      const issuer = makeLink("secret-used-to-issue-token-1234567");
      const verifier = makeLink("different-secret-used-to-verify-!!");
      const token = issuer.issue("interview-abc");

      const result = verifier.verify(token);

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidCandidateTokenError);
    });

    it("returns InvalidCandidateTokenError when the payload byte is tampered", () => {
      const link = makeLink();
      const token = link.issue("interview-abc");

      // Swap the first character of the payload portion (before the dot)
      const [payloadB64, sigB64] = token.split(".") as [string, string];
      const tamperedPayload =
        payloadB64[0] === "a" ? "b" + payloadB64.slice(1) : "a" + payloadB64.slice(1);
      const tamperedToken = `${tamperedPayload}.${sigB64}`;

      const result = link.verify(tamperedToken);

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidCandidateTokenError);
    });

    it("returns InvalidCandidateTokenError for an expired token (TTL = -1s)", () => {
      const link = makeLink(VALID_SECRET, -1);
      const token = link.issue("interview-abc");

      const result = link.verify(token);

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidCandidateTokenError);
    });

    it("returns InvalidCandidateTokenError for a malformed token with no dot separator", () => {
      const link = makeLink();

      const result = link.verify("notadottedtoken");

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidCandidateTokenError);
    });

    it("returns InvalidCandidateTokenError for a token with garbage base64 in payload", () => {
      const link = makeLink();

      // Contains characters outside the base64url alphabet (+ and /)
      const result = link.verify("!!!invalid+payload!!!.validenoughsig");

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidCandidateTokenError);
    });

    it("returns InvalidCandidateTokenError for a token with garbage base64 in signature", () => {
      const link = makeLink();
      const token = link.issue("interview-abc");
      const [payloadB64] = token.split(".") as [string];

      const result = link.verify(`${payloadB64}.!!!invalid+sig!!!`);

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidCandidateTokenError);
    });

    it("returns InvalidCandidateTokenError for an empty string", () => {
      const link = makeLink();

      const result = link.verify("");

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidCandidateTokenError);
    });
  });
});

describe("candidateSignedLinkFromEnv", () => {
  it("returns Err when CANDIDATE_LINK_SECRET is missing", () => {
    const result = candidateSignedLinkFromEnv({});

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/CANDIDATE_LINK_SECRET/);
  });

  it("returns Err when CANDIDATE_LINK_SECRET is shorter than 32 chars", () => {
    const result = candidateSignedLinkFromEnv({ CANDIDATE_LINK_SECRET: "short" });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/CANDIDATE_LINK_SECRET/);
  });

  it("returns Err when CANDIDATE_LINK_SECRET is exactly 31 chars", () => {
    const result = candidateSignedLinkFromEnv({ CANDIDATE_LINK_SECRET: "a".repeat(31) });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/CANDIDATE_LINK_SECRET/);
  });

  it("returns Ok when CANDIDATE_LINK_SECRET is exactly 32 chars and no TTL override", () => {
    const result = candidateSignedLinkFromEnv({ CANDIDATE_LINK_SECRET: VALID_SECRET });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeInstanceOf(CandidateSignedLink);
    // Default TTL is 7 days
    expect(result.unwrap().defaultTtlSeconds).toBe(7 * 24 * 60 * 60);
  });

  it("returns Ok with the configured TTL when CANDIDATE_LINK_TTL_SECONDS is valid", () => {
    const result = candidateSignedLinkFromEnv({
      CANDIDATE_LINK_SECRET: VALID_SECRET,
      CANDIDATE_LINK_TTL_SECONDS: "3600",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().defaultTtlSeconds).toBe(3600);
  });

  it("returns Err when CANDIDATE_LINK_TTL_SECONDS is zero", () => {
    const result = candidateSignedLinkFromEnv({
      CANDIDATE_LINK_SECRET: VALID_SECRET,
      CANDIDATE_LINK_TTL_SECONDS: "0",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/CANDIDATE_LINK_TTL_SECONDS/);
  });

  it("returns Err when CANDIDATE_LINK_TTL_SECONDS is negative", () => {
    const result = candidateSignedLinkFromEnv({
      CANDIDATE_LINK_SECRET: VALID_SECRET,
      CANDIDATE_LINK_TTL_SECONDS: "-100",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/CANDIDATE_LINK_TTL_SECONDS/);
  });

  it("returns Err when CANDIDATE_LINK_TTL_SECONDS is not a number", () => {
    const result = candidateSignedLinkFromEnv({
      CANDIDATE_LINK_SECRET: VALID_SECRET,
      CANDIDATE_LINK_TTL_SECONDS: "not-a-number",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/CANDIDATE_LINK_TTL_SECONDS/);
  });
});
