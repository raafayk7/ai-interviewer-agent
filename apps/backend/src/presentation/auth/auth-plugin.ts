import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { fromNodeHeaders } from "../utils/from-node-headers.js";

export interface AuthSession {
  readonly userId: string;
  readonly email: string;
}

export interface AuthApiLike {
  readonly getSession: (input: { headers: Headers }) => Promise<{
    readonly user: { readonly id: string; readonly email: string };
  } | null>;
}

export interface AuthPluginOptions {
  readonly auth: {
    readonly api: AuthApiLike;
  };
}

declare module "fastify" {
  interface FastifyRequest {
    session: AuthSession | null;
  }
}

export async function installAuthPlugin(
  app: FastifyInstance,
  opts: AuthPluginOptions,
): Promise<void> {
  app.decorateRequest("session", null);
  app.addHook("preHandler", async (req) => {
    const session = await opts.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    req.session = session
      ? { userId: session.user.id, email: session.user.email }
      : null;
  });
}

export async function requireRecruiter(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!req.session) {
    await reply.code(401).send({
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  }
}
