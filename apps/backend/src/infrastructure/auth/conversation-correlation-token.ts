import { createHmac, timingSafeEqual } from "node:crypto";
import { Result } from "@carbonteq/fp";
import {
  InvalidConversationCorrelationTokenError,
  type ConversationCorrelationTokenPayload,
  type IConversationCorrelationTokenIssuer,
} from "@repo/application";

export type { ConversationCorrelationTokenPayload } from "@repo/application";
export { InvalidConversationCorrelationTokenError } from "@repo/application";

export interface ConversationCorrelationTokenConfig {
  readonly secret: string;
  readonly ttlMs: number;
  readonly nowMs?: () => number;
}

export class ConversationCorrelationToken implements IConversationCorrelationTokenIssuer {
  private readonly nowMs: () => number;

  constructor(private readonly config: ConversationCorrelationTokenConfig) {
    this.nowMs = config.nowMs ?? Date.now;
  }

  issue(interviewId: string): string {
    const payload: ConversationCorrelationTokenPayload = {
      interviewId,
      issuedAtMs: this.nowMs(),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.config.secret)
      .update(payloadB64)
      .digest("base64url");

    return `${payloadB64}.${signature}`;
  }

  verify(
    token: string,
  ): Result<ConversationCorrelationTokenPayload, InvalidConversationCorrelationTokenError> {
    const parts = token.split(".");
    if (parts.length !== 2) {
      return this.invalid("Conversation correlation token is malformed");
    }

    const [payloadB64, signatureB64] = parts as [string, string];
    if (!isBase64Url(payloadB64) || !isBase64Url(signatureB64)) {
      return this.invalid("Conversation correlation token is malformed");
    }

    const expected = createHmac("sha256", this.config.secret)
      .update(payloadB64)
      .digest();
    const provided = Buffer.from(signatureB64, "base64url");

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return this.invalid("Conversation correlation token signature mismatch");
    }

    const payloadResult = Result.tryCatch(
      () =>
        JSON.parse(
          Buffer.from(payloadB64, "base64url").toString("utf8"),
        ) as ConversationCorrelationTokenPayload,
      () => new InvalidConversationCorrelationTokenError("Conversation correlation token payload is malformed"),
    );

    if (payloadResult.isErr()) {
      return payloadResult;
    }

    const payload = payloadResult.unwrap();
    if (
      !payload.interviewId ||
      !Number.isFinite(payload.issuedAtMs) ||
      this.nowMs() - payload.issuedAtMs > this.config.ttlMs ||
      payload.issuedAtMs > this.nowMs()
    ) {
      return this.invalid("Conversation correlation token invalid or expired");
    }

    return Result.Ok(payload);
  }

  private invalid(
    message: string,
  ): Result<never, InvalidConversationCorrelationTokenError> {
    return Result.Err(new InvalidConversationCorrelationTokenError(message));
  }
}

export function conversationCorrelationTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Result<ConversationCorrelationToken, Error> {
  const secret = env["ELEVENLABS_SESSION_TOKEN_SECRET"];
  if (!secret || secret.length < 32) {
    return Result.Err(
      new Error("ELEVENLABS_SESSION_TOKEN_SECRET must be set (>= 32 chars)"),
    );
  }

  return Result.Ok(
    new ConversationCorrelationToken({
      secret,
      ttlMs: 5 * 60_000,
    }),
  );
}

function isBase64Url(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}
