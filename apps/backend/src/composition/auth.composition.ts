import { createRequire } from "node:module";
import { authEnvFrom } from "../infrastructure/auth/auth-env.js";
import { createAuth, type AuthInstance } from "../infrastructure/auth/auth.js";
import {
  CandidateSignedLink,
  candidateSignedLinkFromEnv,
} from "../infrastructure/auth/candidate-signed-link.js";
import type { Database } from "../infrastructure/persistence/db.js";

const require = createRequire(import.meta.url);

export interface AuthDeps {
  readonly auth: AuthInstance;
  readonly candidateLink: CandidateSignedLink;
}

export interface AuthCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly db?: Database;
}

export function buildAuthDeps(options: AuthCompositionOptions = {}): AuthDeps {
  const env = options.env ?? process.env;

  const authEnv = authEnvFrom(env);
  if (authEnv.isErr()) {
    throw new Error(`Boot failed: ${authEnv.unwrapErr().message}`);
  }

  const candidateLink = candidateSignedLinkFromEnv(env);
  if (candidateLink.isErr()) {
    throw new Error(`Boot failed: ${candidateLink.unwrapErr().message}`);
  }

  const db: Database =
    options.db ??
    (
      require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")
    ).db;

  const { betterAuthSecret, betterAuthUrl } = authEnv.unwrap();

  return {
    auth: createAuth({
      secret: betterAuthSecret,
      baseUrl: betterAuthUrl,
      db,
    }),
    candidateLink: candidateLink.unwrap(),
  };
}
