import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "../persistence/db.js";
import * as schema from "../persistence/schema/index.js";

export interface AuthConfig {
  readonly secret: string;
  readonly baseUrl: string;
  readonly db: Database;
  readonly trustedOrigins?: readonly string[];
}

export function createAuth(config: AuthConfig) {
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    trustedOrigins: config.trustedOrigins
      ? [...config.trustedOrigins]
      : ["http://localhost:3000"],
    database: drizzleAdapter(config.db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    socialProviders: {},
    plugins: [],
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
