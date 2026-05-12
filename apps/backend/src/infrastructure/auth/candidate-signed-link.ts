import { createHmac, timingSafeEqual } from "node:crypto";
import { Result } from "@carbonteq/fp";
import { InvalidCandidateTokenError } from "@repo/application";

export interface CandidateSignedLinkConfig {
  readonly secret: string;
  readonly defaultTtlSeconds: number;
}

export class CandidateSignedLink {
  constructor(private readonly config: CandidateSignedLinkConfig) {}

  get defaultTtlSeconds(): number {
    return this.config.defaultTtlSeconds;
  }

  issue(interviewId: string, ttlSeconds?: number): string {
    const ttl = ttlSeconds ?? this.config.defaultTtlSeconds;
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const payload = `${interviewId}|${exp}`;
    const sig = createHmac("sha256", this.config.secret)
      .update(payload)
      .digest();

    return [
      Buffer.from(payload, "utf8").toString("base64url"),
      sig.toString("base64url"),
    ].join(".");
  }

  verify(
    token: string,
  ): Result<{ readonly interviewId: string }, InvalidCandidateTokenError> {
    const parts = token.split(".");
    if (parts.length !== 2) {
      return Result.Err(
        new InvalidCandidateTokenError("Candidate link is malformed"),
      );
    }

    const [payloadB64, sigB64] = parts as [string, string];
    if (!isBase64Url(payloadB64) || !isBase64Url(sigB64)) {
      return Result.Err(
        new InvalidCandidateTokenError("Candidate link is malformed"),
      );
    }

    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const sig = Buffer.from(sigB64, "base64url");
    const expected = createHmac("sha256", this.config.secret)
      .update(payload)
      .digest();
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
      return Result.Err(
        new InvalidCandidateTokenError("Candidate link signature mismatch"),
      );
    }

    const payloadParts = payload.split("|");
    if (payloadParts.length !== 2) {
      return Result.Err(
        new InvalidCandidateTokenError("Candidate link is malformed"),
      );
    }

    const [interviewId, expStr] = payloadParts as [string, string];
    const exp = Number.parseInt(expStr, 10);
    if (
      !interviewId ||
      !Number.isFinite(exp) ||
      exp <= Math.floor(Date.now() / 1000)
    ) {
      return Result.Err(
        new InvalidCandidateTokenError("Candidate link invalid or expired"),
      );
    }

    return Result.Ok({ interviewId });
  }
}

export function candidateSignedLinkFromEnv(
  env: NodeJS.ProcessEnv,
): Result<CandidateSignedLink, Error> {
  const secret = env["CANDIDATE_LINK_SECRET"];
  if (!secret || secret.length < 32) {
    return Result.Err(
      new Error("CANDIDATE_LINK_SECRET must be set (>= 32 chars)"),
    );
  }

  const ttlRaw = env["CANDIDATE_LINK_TTL_SECONDS"];
  const ttl = ttlRaw ? Number.parseInt(ttlRaw, 10) : 7 * 24 * 60 * 60;
  if (!Number.isInteger(ttl) || ttl <= 0) {
    return Result.Err(
      new Error("CANDIDATE_LINK_TTL_SECONDS must be a positive integer"),
    );
  }

  return Result.Ok(new CandidateSignedLink({ secret, defaultTtlSeconds: ttl }));
}

function isBase64Url(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}
