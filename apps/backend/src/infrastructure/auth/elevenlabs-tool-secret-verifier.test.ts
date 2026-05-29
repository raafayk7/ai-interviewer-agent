import { describe, expect, it } from "vitest";
import {
  ElevenLabsToolSecretVerifier,
  InvalidToolSecretError,
  elevenLabsToolSecretVerifierFromEnv,
} from "./elevenlabs-tool-secret-verifier.js";

const VALID_SECRET = "a".repeat(32);

describe("ElevenLabsToolSecretVerifier", () => {
  it("accepts a matching x-voice-secret header", () => {
    const verifier = new ElevenLabsToolSecretVerifier({ secret: VALID_SECRET });

    const result = verifier.verify(VALID_SECRET);

    expect(result.isOk()).toBe(true);
  });

  it("rejects a missing header (undefined)", () => {
    const verifier = new ElevenLabsToolSecretVerifier({ secret: VALID_SECRET });

    const result = verifier.verify(undefined);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InvalidToolSecretError);
    expect(result.unwrapErr().message).toContain("Missing");
  });

  it("rejects a wrong secret value", () => {
    const verifier = new ElevenLabsToolSecretVerifier({ secret: VALID_SECRET });

    const result = verifier.verify("wrong-secret-that-is-definitely-bad");

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InvalidToolSecretError);
    expect(result.unwrapErr().message).toContain("mismatch");
  });

  it("rejects a secret of different length (timing-safe comparison)", () => {
    const verifier = new ElevenLabsToolSecretVerifier({ secret: VALID_SECRET });

    const result = verifier.verify("short");

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InvalidToolSecretError);
  });
});

describe("elevenLabsToolSecretVerifierFromEnv", () => {
  it("returns Err when ELEVENLABS_TOOL_WEBHOOK_SECRET is not set", () => {
    const result = elevenLabsToolSecretVerifierFromEnv({});

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/ELEVENLABS_TOOL_WEBHOOK_SECRET/);
  });

  it("returns Err when secret is shorter than 32 chars", () => {
    const result = elevenLabsToolSecretVerifierFromEnv({
      ELEVENLABS_TOOL_WEBHOOK_SECRET: "short",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/>= 32 chars/);
  });

  it("returns a verifier when env has a valid secret", () => {
    const result = elevenLabsToolSecretVerifierFromEnv({
      ELEVENLABS_TOOL_WEBHOOK_SECRET: VALID_SECRET,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeInstanceOf(ElevenLabsToolSecretVerifier);
  });
});
