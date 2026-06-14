import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "../persistence/db.js";
import * as schema from "../persistence/schema/index.js";

export interface AuthConfig {
  readonly secret: string;
  readonly baseUrl: string;
  readonly db: Database;
  readonly trustedOrigins: readonly string[];
  /**
   * When true (cross-site deployment — frontend and backend on different
   * registrable domains, e.g. *.vercel.app ↔ *.onrender.com), issue
   * SameSite=None; Secure; Partitioned session cookies so the browser sends them
   * on cross-site requests. Default false (local dev: same-site localhost over
   * http, where Lax is correct and Secure would block the cookie).
   */
  readonly crossSiteCookies?: boolean;
}

export function createAuth(config: AuthConfig) {
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    trustedOrigins: [...config.trustedOrigins],
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
    ...(config.crossSiteCookies
      ? {
          advanced: {
            defaultCookieAttributes: {
              sameSite: "none",
              secure: true,
              partitioned: true,
            },
          },
        }
      : {}),
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
