import { Result } from "@carbonteq/fp";

export interface CorsEnv {
  readonly origins: readonly string[];
}

const DEV_ORIGINS = ["http://localhost:3000"] as const;

export function corsEnvFrom(env: NodeJS.ProcessEnv): Result<CorsEnv, Error> {
  const raw = env["CORS_ALLOWED_ORIGINS"];
  const nodeEnv = env["NODE_ENV"];

  if (raw === undefined || raw.trim() === "") {
    if (nodeEnv === "production") {
      return Result.Err(
        new Error(
          "CORS_ALLOWED_ORIGINS must be set in production (comma-separated list of allowed origins)",
        ),
      );
    }
    return Result.Ok({ origins: DEV_ORIGINS });
  }

  const origins = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (origins.length === 0) {
    return Result.Err(
      new Error("CORS_ALLOWED_ORIGINS contained no non-empty entries"),
    );
  }

  return Result.Ok({ origins });
}
