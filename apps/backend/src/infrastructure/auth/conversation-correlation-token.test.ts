import { describe, expect, it } from "vitest";
import {
  ConversationCorrelationToken,
  InvalidConversationCorrelationTokenError,
  conversationCorrelationTokenFromEnv,
} from "./conversation-correlation-token.js";

const VALID_SECRET = "s".repeat(32);

const makeToken = (nowMs = 1_800_000_000_000): ConversationCorrelationToken =>
  new ConversationCorrelationToken({
    secret: VALID_SECRET,
    ttlMs: 5 * 60_000,
    nowMs: () => nowMs,
  });

describe("ConversationCorrelationToken", () => {
  it("issues and verifies a token bound to an interview id", () => {
    const token = makeToken();

    const result = token.verify(token.issue("interview-1"));

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      interviewId: "interview-1",
      issuedAtMs: 1_800_000_000_000,
    });
  });

  it("rejects tampered payloads", () => {
    const token = makeToken();
    const issued = token.issue("interview-1");
    const [payloadB64, sigB64] = issued.split(".") as [string, string];
    const tamperedPayload =
      payloadB64[0] === "a" ? `b${payloadB64.slice(1)}` : `a${payloadB64.slice(1)}`;

    const result = token.verify(`${tamperedPayload}.${sigB64}`);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(
      InvalidConversationCorrelationTokenError,
    );
  });

  it("rejects expired tokens", () => {
    const issuer = makeToken(1_800_000_000_000);
    const verifier = makeToken(1_800_000_300_001);

    const result = verifier.verify(issuer.issue("interview-1"));

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/expired/);
  });

  it("rejects malformed tokens", () => {
    const result = makeToken().verify("not-a-token");

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(
      InvalidConversationCorrelationTokenError,
    );
  });
});

describe("conversationCorrelationTokenFromEnv", () => {
  it("requires ELEVENLABS_SESSION_TOKEN_SECRET", () => {
    const result = conversationCorrelationTokenFromEnv({});

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/ELEVENLABS_SESSION_TOKEN_SECRET/);
  });

  it("requires at least 32 chars of secret material", () => {
    const result = conversationCorrelationTokenFromEnv({
      ELEVENLABS_SESSION_TOKEN_SECRET: "short",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/>= 32 chars/);
  });

  it("returns a token helper when env is valid", () => {
    const result = conversationCorrelationTokenFromEnv({
      ELEVENLABS_SESSION_TOKEN_SECRET: VALID_SECRET,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeInstanceOf(ConversationCorrelationToken);
  });
});
