import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import {
  installAuthPlugin,
  type AuthPluginOptions,
} from "./presentation/auth/auth-plugin.js";
import {
  mountBetterAuth,
  type BetterAuthHandlerLike,
} from "./presentation/auth/better-auth-mount.js";
import { installErrorHandler } from "./presentation/errors/http-error-mapper.js";
import {
  registerRecruiterDocumentRoutes,
  type RegisterRecruiterDocumentRoutesOptions,
} from "./presentation/routes/recruiter-documents.routes.js";
import {
  registerRecruiterInterviewRoutes,
  type RegisterRecruiterInterviewRoutesOptions,
} from "./presentation/routes/recruiter-interviews.routes.js";
import {
  registerInterviewSessionRoutes,
  type RegisterInterviewSessionRouteOptions,
} from "./presentation/routes/interview-session.ws.js";

export interface AuthDeps {
  readonly auth: AuthPluginOptions["auth"] & BetterAuthHandlerLike;
  readonly candidateLink?: NonNullable<RegisterInterviewSessionRouteOptions["candidateLink"]> & {
    issue(interviewId: string): string;
    readonly defaultTtlSeconds: number;
  };
}

export interface BuildAppOptions {
  readonly authDeps?: AuthDeps;
  readonly interviewSession?: RegisterInterviewSessionRouteOptions;
  readonly recruiterInterviews?: RegisterRecruiterInterviewRoutesOptions;
  readonly recruiterDocuments?: RegisterRecruiterDocumentRoutesOptions;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: true,
  });

  installErrorHandler(app, app.log);

  await app.register(cors, {
    origin: process.env["CORS_ALLOWED_ORIGINS"]?.split(",").map((s) => s.trim()) ?? [
      "http://localhost:3000",
    ],
    credentials: true,
  });

  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024 },
  });
  await app.register(multipart, {
    attachFieldsToBody: false,
    limits: { fileSize: 25 * 1024 * 1024, files: 2 },
  });

  const composeDefaults =
    !options.authDeps &&
    !options.interviewSession &&
    !options.recruiterInterviews &&
    !options.recruiterDocuments;

  const authDeps =
    options.authDeps ??
    (composeDefaults
      ? (await import("./composition/auth.composition.js")).buildAuthDeps()
      : undefined);

  if (authDeps) {
    await installAuthPlugin(app, { auth: authDeps.auth });
    await mountBetterAuth(app, authDeps.auth);
  }

  app.get("/health", async () => {
    return { status: "ok" };
  });

  const recruiterInterviews =
    options.recruiterInterviews ??
    (composeDefaults && authDeps?.candidateLink
      ? {
          deps: (await import("./composition/recruiter-interview.composition.js")).buildRecruiterInterviewDeps({
            candidateLink: authDeps.candidateLink,
          }),
        }
      : undefined);

  if (recruiterInterviews) {
    await app.register(registerRecruiterInterviewRoutes, {
      prefix: "",
      ...recruiterInterviews,
    });
  }

  const recruiterDocuments =
    options.recruiterDocuments ??
    (composeDefaults
      ? {
          deps: (await import("./composition/recruiter-document.composition.js")).buildRecruiterDocumentDeps(),
        }
      : undefined);

  if (recruiterDocuments) {
    await app.register(registerRecruiterDocumentRoutes, {
      prefix: "",
      ...recruiterDocuments,
    });
  }

  const interviewSessionOptions = options.interviewSession ?? {
    deps: (await import("./composition/interview-session.composition.js")).buildInterviewSessionDeps(),
    candidateLink: authDeps?.candidateLink,
  };

  await app.register(registerInterviewSessionRoutes, {
    prefix: "/interviews",
    ...interviewSessionOptions,
  });

  return app;
}
