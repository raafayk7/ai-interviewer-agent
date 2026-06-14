import { Result } from "@carbonteq/fp";

export interface AuthEnv {
  readonly betterAuthSecret: string;
  readonly betterAuthUrl: string;
  readonly trustedOrigins: readonly string[];
}

const DEV_TRUSTED_ORIGINS = ["http://localhost:3000"] as const;

function parseTrustedOrigins(
  raw: string | undefined,
  nodeEnv: string | undefined,
): Result<readonly string[], Error> {
  if (raw === undefined || raw.trim() === "") {
    if (nodeEnv === "production") {
      return Result.Err(
        new Error(
          "BETTER_AUTH_TRUSTED_ORIGINS must be set in production (comma-separated list of allowed origins)",
        ),
      );
    }
    return Result.Ok(DEV_TRUSTED_ORIGINS);
  }

  const origins = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (origins.length === 0) {
    return Result.Err(
      new Error("BETTER_AUTH_TRUSTED_ORIGINS contained no non-empty entries"),
    );
  }

  return Result.Ok(origins);
}

export function authEnvFrom(env: NodeJS.ProcessEnv): Result<AuthEnv, Error> {
  const secret = env["BETTER_AUTH_SECRET"];
  const url = env["BETTER_AUTH_URL"];

  if (!secret || secret.length < 32) {
    return Result.Err(
      new Error("BETTER_AUTH_SECRET must be set (>= 32 chars)"),
    );
  }

  if (!url) {
    return Result.Err(new Error("BETTER_AUTH_URL must be set"));
  }

  const trustedOrigins = parseTrustedOrigins(
    env["BETTER_AUTH_TRUSTED_ORIGINS"],
    env["NODE_ENV"],
  );
  if (trustedOrigins.isErr()) {
    return Result.Err(trustedOrigins.unwrapErr());
  }

  return Result.Ok({
    betterAuthSecret: secret,
    betterAuthUrl: url,
    trustedOrigins: trustedOrigins.unwrap(),
  });
}
