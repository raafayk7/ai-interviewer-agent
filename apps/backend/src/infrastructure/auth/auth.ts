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
   * Parent domain for cross-subdomain session cookies, e.g. ".sift-ai.space".
   * Set it when the frontend and backend are subdomains of one site
   * (app-dev.sift-ai.space ↔ api-dev.sift-ai.space): better-auth then scopes the
   * session cookie to this domain — `__Secure-…; Domain=.sift-ai.space;
   * SameSite=Lax; Secure` — so it is shared across both subdomains. That is
   * required because the frontend's server-side auth gate forwards the browser's
   * inbound cookie to the backend's get-session; a host-only cookie on the API
   * subdomain would be invisible to the frontend's SSR. Leave unset for local dev
   * (host-only Lax over http, where Secure would block the cookie).
   */
  readonly cookieDomain?: string;
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
    ...(config.cookieDomain
      ? {
          advanced: {
            crossSubDomainCookies: {
              enabled: true,
              domain: config.cookieDomain,
            },
          },
        }
      : {}),
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
