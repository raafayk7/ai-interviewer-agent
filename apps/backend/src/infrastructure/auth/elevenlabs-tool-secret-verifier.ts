import { timingSafeEqual } from "node:crypto";
import { Result } from "@carbonteq/fp";
import { ServiceInfraError } from "@repo/application";

export class InvalidToolSecretError extends ServiceInfraError {
  readonly code = "INVALID_TOOL_SECRET";
}

export interface ToolSecretVerifierConfig {
  readonly secret: string;
}

export class ElevenLabsToolSecretVerifier {
  constructor(private readonly config: ToolSecretVerifierConfig) {}

  verify(headerValue: string | undefined): Result<void, InvalidToolSecretError> {
    if (!headerValue) {
      return Result.Err(new InvalidToolSecretError("Missing x-voice-secret header"));
    }
    const provided = Buffer.from(headerValue, "utf8");
    const expected = Buffer.from(this.config.secret, "utf8");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return Result.Err(new InvalidToolSecretError("x-voice-secret mismatch"));
    }
    return Result.Ok(undefined);
  }
}

export function elevenLabsToolSecretVerifierFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Result<ElevenLabsToolSecretVerifier, Error> {
  const secret = env["ELEVENLABS_TOOL_WEBHOOK_SECRET"];
  if (!secret || secret.length < 32) {
    return Result.Err(
      new Error("ELEVENLABS_TOOL_WEBHOOK_SECRET must be set (>= 32 chars)"),
    );
  }
  return Result.Ok(new ElevenLabsToolSecretVerifier({ secret }));
}
