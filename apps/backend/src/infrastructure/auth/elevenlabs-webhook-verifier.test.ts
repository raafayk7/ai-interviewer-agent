import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ElevenLabsWebhookVerifier,
  InvalidWebhookSignatureError,
  elevenLabsWebhookVerifierFromEnv,
} from "./elevenlabs-webhook-verifier.js";

const VALID_SECRET = "w".repeat(32);

const sign = (body: string, timestamp: string, secret = VALID_SECRET): string => {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v0=${signature}`;
};

describe("ElevenLabsWebhookVerifier", () => {
  it("accepts a valid ElevenLabs HMAC signature", () => {
    const verifier = new ElevenLabsWebhookVerifier({ secret: VALID_SECRET });
    const body = JSON.stringify({ conversation_id: "conv-1" });

    const result = verifier.verify(body, sign(body, "1800000000"));

    expect(result.isOk()).toBe(true);
  });

  it("rejects missing signatures", () => {
    const verifier = new ElevenLabsWebhookVerifier({ secret: VALID_SECRET });

    const result = verifier.verify("{}", undefined);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it("rejects signature mismatches", () => {
    const verifier = new ElevenLabsWebhookVerifier({ secret: VALID_SECRET });
    const body = JSON.stringify({ conversation_id: "conv-1" });

    const result = verifier.verify(body, sign(body, "1800000000", "x".repeat(32)));

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it("rejects malformed signature headers", () => {
    const verifier = new ElevenLabsWebhookVerifier({ secret: VALID_SECRET });

    const result = verifier.verify("{}", "v0=not-hex");

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InvalidWebhookSignatureError);
  });
});

describe("elevenLabsWebhookVerifierFromEnv", () => {
  it("requires ELEVENLABS_WEBHOOK_SECRET", () => {
    const result = elevenLabsWebhookVerifierFromEnv({});

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/ELEVENLABS_WEBHOOK_SECRET/);
  });

  it("requires at least 32 chars of secret material", () => {
    const result = elevenLabsWebhookVerifierFromEnv({
      ELEVENLABS_WEBHOOK_SECRET: "short",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/>= 32 chars/);
  });

  it("returns a verifier when env is valid", () => {
    const result = elevenLabsWebhookVerifierFromEnv({
      ELEVENLABS_WEBHOOK_SECRET: VALID_SECRET,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeInstanceOf(ElevenLabsWebhookVerifier);
  });
});
