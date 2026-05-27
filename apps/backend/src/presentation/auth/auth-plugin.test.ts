import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  installAuthPlugin,
  requireRecruiter,
  type AuthPluginOptions,
} from "./auth-plugin.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeAuthMock(sessionResult: { user: { id: string; email: string } } | null): AuthPluginOptions["auth"] {
  return {
    api: {
      getSession: vi.fn().mockResolvedValue(sessionResult),
    },
  };
}

async function buildTestApp(auth: AuthPluginOptions["auth"]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await installAuthPlugin(app, { auth });

  // A probe route that reads req.session back into the response
  app.get("/probe", async (req, reply) => {
    return reply.code(200).send({ session: req.session });
  });

  // A route guarded by requireRecruiter
  app.get(
    "/protected",
    { preHandler: requireRecruiter },
    async (req, reply) => {
      return reply.code(200).send({ userId: req.session!.userId });
    },
  );

  await app.ready();
  return app;
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("installAuthPlugin", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  describe("session decoration", () => {
    it("populates req.session when getSession returns a session", async () => {
      const auth = makeAuthMock({ user: { id: "user-123", email: "user@example.com" } });
      app = await buildTestApp(auth);

      const response = await app.inject({ method: "GET", url: "/probe" });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ session: { userId: string; email: string } | null }>();
      expect(body.session).not.toBeNull();
      expect(body.session!.userId).toBe("user-123");
      expect(body.session!.email).toBe("user@example.com");
    });

    it("sets req.session to null when getSession returns null", async () => {
      const auth = makeAuthMock(null);
      app = await buildTestApp(auth);

      const response = await app.inject({ method: "GET", url: "/probe" });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ session: null }>();
      expect(body.session).toBeNull();
    });
  });
});

describe("requireRecruiter", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("blocks the request with 401 when req.session is null (unauthenticated)", async () => {
    const auth = makeAuthMock(null);
    app = await buildTestApp(auth);

    const response = await app.inject({ method: "GET", url: "/protected" });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("passes through to the route handler when req.session is populated", async () => {
    const auth = makeAuthMock({ user: { id: "user-456", email: "recruiter@company.com" } });
    app = await buildTestApp(auth);

    const response = await app.inject({ method: "GET", url: "/protected" });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ userId: string }>();
    expect(body.userId).toBe("user-456");
  });
});
