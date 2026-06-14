import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit, { type RateLimitOptions } from "@fastify/rate-limit";

/**
 * Rate limiting for public HTTP surfaces (ADR-037).
 *
 * Registered with `global: false`: limits are OPT-IN per route via
 * `config.rateLimit`. Nothing is throttled unless it asks to be — deliberate,
 * because a blanket per-IP limit on /api/auth/* would throttle server-side
 * `get-session` calls (see `authRouteRateLimit`).
 *
 * Store: the plugin default is in-memory, which is correct for a SINGLE backend
 * instance (the staging topology on Render). Per-IP counters live in that one
 * process. Horizontal scaling (>1 instance) would make in-memory counters
 * per-instance and therefore ineffective, requiring a shared Redis store —
 * deferred until horizontal scaling actually arrives.
 *
 * Keying: the default keyGenerator uses `req.ip`. Behind a proxy (Render),
 * `req.ip` only resolves to the real client when Fastify `trustProxy` is set —
 * see `trustProxyFromEnv`. Without it every caller shares the proxy's IP bucket.
 */
export async function installRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, { global: false });
}

export interface RouteRateLimit {
  readonly max: number;
  readonly timeWindow: string;
}

export interface RateLimits {
  /** Credential endpoints (sign-in / sign-up): brute-force / credential-stuffing guard. */
  readonly auth: RouteRateLimit;
  /** Candidate-session mint: each call can start a paid ElevenLabs conversation. */
  readonly candidateSession: RouteRateLimit;
}

const DEFAULT_AUTH_PER_MIN = 10;
const DEFAULT_CANDIDATE_SESSION_PER_MIN = 10;

function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Per-route thresholds, optionally overridable via env (sensible defaults so the
 * app boots without them). Both windows are per minute, per IP.
 *   RATE_LIMIT_AUTH_PER_MIN             (default 10) — sign-in / sign-up
 *   RATE_LIMIT_CANDIDATE_SESSION_PER_MIN (default 10) — candidate-session mint;
 *     kept generous because ADR-035 session reconnects re-issue the mint.
 */
export function rateLimitsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RateLimits {
  return {
    auth: {
      max: positiveIntFromEnv(env["RATE_LIMIT_AUTH_PER_MIN"], DEFAULT_AUTH_PER_MIN),
      timeWindow: "1 minute",
    },
    candidateSession: {
      max: positiveIntFromEnv(
        env["RATE_LIMIT_CANDIDATE_SESSION_PER_MIN"],
        DEFAULT_CANDIDATE_SESSION_PER_MIN,
      ),
      timeWindow: "1 minute",
    },
  };
}

/**
 * Fastify `trustProxy`. Behind Render's proxy the client IP arrives in
 * X-Forwarded-For; `trustProxy` makes `req.ip` resolve to it so per-IP rate
 * limiting keys on the caller, not the proxy.
 *
 *   unset / "false" → false  (local dev: no proxy, use the socket IP)
 *   "true"          → true   (trust the whole XFF chain, leftmost — spoofable)
 *   "<n>"           → n      (trust n proxy hops from the right; "1" on Render)
 *
 * Prefer the hop count ("1") in production: it resists a client spoofing its own
 * X-Forwarded-For, which `true` does not.
 */
export function trustProxyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean | number {
  const raw = env["TRUST_PROXY"];
  if (!raw || raw === "false") return false;
  if (raw === "true") return true;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : false;
}

/**
 * Per-route rate-limit config for the better-auth catch-all (`/api/auth/*`).
 *
 * The catch-all serves EVERY auth path, but only the browser-originated
 * credential endpoints (sign-in / sign-up) are brute-force targets worth
 * throttling per IP. `/api/auth/get-session` is called SERVER-SIDE from the
 * frontend's shared egress IP (Vercel) during route auth gating — a per-IP limit
 * there would throttle every user through one bucket. The allowList therefore
 * SKIPS (returns true) every non-credential path, and also skips CORS preflight
 * (OPTIONS) so a preflight does not consume a credential attempt.
 */
export function authRouteRateLimit(limit: RouteRateLimit): RateLimitOptions {
  return {
    max: limit.max,
    timeWindow: limit.timeWindow,
    allowList: (req: FastifyRequest) =>
      req.method === "OPTIONS" || !isCredentialAuthPath(req.url),
  };
}

function isCredentialAuthPath(url: string): boolean {
  const path = url.split("?", 1)[0] ?? url;
  return path.includes("/sign-in") || path.includes("/sign-up");
}
