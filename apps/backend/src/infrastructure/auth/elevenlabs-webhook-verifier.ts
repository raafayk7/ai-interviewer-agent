import { createHmac, timingSafeEqual } from "node:crypto";
import { Result } from "@carbonteq/fp";
import { ServiceInfraError } from "@repo/application";

export interface ElevenLabsWebhookVerifierConfig {
  readonly secret: string;
}

export class InvalidWebhookSignatureError extends ServiceInfraError {
  readonly code = "INVALID_WEBHOOK_SIGNATURE";
}

export class ElevenLabsWebhookVerifier {
  constructor(private readonly config: ElevenLabsWebhookVerifierConfig) {}

  verify(
    rawBody: string | Buffer,
    signatureHeader: string | undefined,
  ): Result<void, InvalidWebhookSignatureError> {
    if (!signatureHeader) {
      return this.invalid("ElevenLabs webhook signature is missing");
    }

    const parsed = parseSignatureHeader(signatureHeader);
    if (!parsed) {
      return this.invalid("ElevenLabs webhook signature is malformed");
    }

    const expected = createHmac("sha256", this.config.secret)
      .update(`${parsed.timestamp}.${rawBody.toString("utf8")}`)
      .digest();
    const provided = Buffer.from(parsed.signatureHex, "hex");

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return this.invalid("ElevenLabs webhook signature mismatch");
    }

    return Result.Ok(undefined);
  }

  private invalid(message: string): Result<never, InvalidWebhookSignatureError> {
    return Result.Err(new InvalidWebhookSignatureError(message));
  }
}

export function elevenLabsWebhookVerifierFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Result<ElevenLabsWebhookVerifier, Error> {
  const secret = env["ELEVENLABS_WEBHOOK_SECRET"];
  if (!secret || secret.length < 32) {
    return Result.Err(
      new Error("ELEVENLABS_WEBHOOK_SECRET must be set (>= 32 chars)"),
    );
  }

  return Result.Ok(new ElevenLabsWebhookVerifier({ secret }));
}

function parseSignatureHeader(
  value: string,
): { readonly timestamp: string; readonly signatureHex: string } | null {
  const parts = new Map(
    value.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = parts.get("t");
  const signatureHex = parts.get("v0");

  if (!timestamp || !signatureHex || !/^[0-9a-fA-F]+$/.test(signatureHex)) {
    return null;
  }

  return { timestamp, signatureHex };
}
