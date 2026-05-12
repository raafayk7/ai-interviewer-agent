import { Result } from "@carbonteq/fp";

export interface AuthEnv {
  readonly betterAuthSecret: string;
  readonly betterAuthUrl: string;
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

  return Result.Ok({ betterAuthSecret: secret, betterAuthUrl: url });
}
