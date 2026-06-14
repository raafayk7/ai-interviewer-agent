import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  installRateLimit,
  rateLimitsFromEnv,
  trustProxyFromEnv,
} from "./rate-limit.js";
import { mountBetterAuth } from "../auth/better-auth-mount.js";

describe("trustProxyFromEnv", () => {
  it("defaults to false when unset (local dev, no proxy)", () => {
    expect(trustProxyFromEnv({})).toBe(false);
  });

  it("parses 'false' → false and 'true' → true", () => {
    expect(trustProxyFromEnv({ TRUST_PROXY: "false" })).toBe(false);
    expect(trustProxyFromEnv({ TRUST_PROXY: "true" })).toBe(true);
  });

  it("parses a hop count to a number (e.g. '1' on Render)", () => {
    expect(trustProxyFromEnv({ TRUST_PROXY: "1" })).toBe(1);
    expect(trustProxyFromEnv({ TRUST_PROXY: "2" })).toBe(2);
    expect(trustProxyFromEnv({ TRUST_PROXY: "0" })).toBe(0);
  });

  it("falls back to false on garbage / negative", () => {
    expect(trustProxyFromEnv({ TRUST_PROXY: "abc" })).toBe(false);
    expect(trustProxyFromEnv({ TRUST_PROXY: "-1" })).toBe(false);
    expect(trustProxyFromEnv({ TRUST_PROXY: "1.5" })).toBe(false);
  });
});

describe("rateLimitsFromEnv", () => {
  it("uses defaults when env is empty", () => {
    const limits = rateLimitsFromEnv({});
    expect(limits.auth).toEqual({ max: 10, timeWindow: "1 minute" });
    expect(limits.candidateSession).toEqual({ max: 10, timeWindow: "1 minute" });
  });

  it("honors positive-integer overrides", () => {
    const limits = rateLimitsFromEnv({
      RATE_LIMIT_AUTH_PER_MIN: "5",
      RATE_LIMIT_CANDIDATE_SESSION_PER_MIN: "3",
    });
    expect(limits.auth.max).toBe(5);
    expect(limits.candidateSession.max).toBe(3);
  });

  it("ignores non-positive / non-integer overrides", () => {
    const limits = rateLimitsFromEnv({
      RATE_LIMIT_AUTH_PER_MIN: "0",
      RATE_LIMIT_CANDIDATE_SESSION_PER_MIN: "x",
    });
    expect(limits.auth.max).toBe(10);
    expect(limits.candidateSession.max).toBe(10);
  });
});

describe("installRateLimit (per-route opt-in)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("does not throttle routes that don't opt in", async () => {
    app = Fastify();
    await installRateLimit(app);
    app.get("/open", async () => ({ ok: true }));

    for (let i = 0; i < 25; i++) {
      const res = await app.inject({ method: "GET", url: "/open" });
      expect(res.statusCode).toBe(200);
    }
  });

  it("returns 429 past the max once a route opts in", async () => {
    app = Fastify();
    await installRateLimit(app);
    app.post(
      "/mint",
      { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
      async () => ({ ok: true }),
    );

    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: "POST", url: "/mint" });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 429]);

    const limited = await app.inject({ method: "POST", url: "/mint" });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["x-ratelimit-limit"]).toBe("2");
  });
});

describe("mountBetterAuth rate limiting", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const stubAuth = {
    handler: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  };

  it("throttles sign-in past the max", async () => {
    app = Fastify();
    await installRateLimit(app);
    await mountBetterAuth(app, stubAuth, { max: 2, timeWindow: "1 minute" });

    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 429]);
  });

  it("throttles sign-up past the max", async () => {
    app = Fastify();
    await installRateLimit(app);
    await mountBetterAuth(app, stubAuth, { max: 2, timeWindow: "1 minute" });

    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 429]);
  });

  it("NEVER throttles get-session, even past the auth max (server-side shared IP)", async () => {
    app = Fastify();
    await installRateLimit(app);
    await mountBetterAuth(app, stubAuth, { max: 2, timeWindow: "1 minute" });

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/get-session",
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it("does not count CORS preflight (OPTIONS) against the sign-in budget", async () => {
    app = Fastify();
    await installRateLimit(app);
    await mountBetterAuth(app, stubAuth, { max: 2, timeWindow: "1 minute" });

    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "OPTIONS", url: "/api/auth/sign-in/email" });
    }
    // The 5 preflights must not have consumed the budget, so two real POSTs succeed.
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });

  it("applies no limit when no rate-limit config is passed", async () => {
    app = Fastify();
    await installRateLimit(app);
    await mountBetterAuth(app, stubAuth);

    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
