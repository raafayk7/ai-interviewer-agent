import { Result } from "@carbonteq/fp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { InvalidCandidateTokenError } from "@repo/application";
import { InterviewNotFoundError } from "@repo/domain";
import { buildApp } from "../../app.js";
import type { CandidateInterviewControllerDeps } from "./candidate-interview.controller.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

const INTERVIEW_ID = "interview-abc-123";
const OTHER_INTERVIEW_ID = "interview-xyz-999";

const baseView = () => ({
  interviewId: INTERVIEW_ID,
  candidateName: "Jane Doe",
  jobTitle: "Senior Backend Engineer",
  company: "Acme Corp",
  scheduledAt: new Date("2025-06-01T09:00:00Z").toISOString(),
  targetDurationMinutes: 45,
  status: "SCHEDULED" as const,
});

function makeDeps(
  overrides: Partial<CandidateInterviewControllerDeps> = {},
): CandidateInterviewControllerDeps {
  return {
    getCandidateInterviewViewUseCase: {
      execute: vi.fn().mockResolvedValue(Result.Ok({ view: baseView() })),
    },
    candidateLink: {
      verify: vi.fn().mockReturnValue(Result.Ok({ interviewId: INTERVIEW_ID })),
    },
    ...overrides,
  };
}

async function buildTestApp(deps: CandidateInterviewControllerDeps): Promise<FastifyInstance> {
  return buildApp({
    candidateInterviews: { deps },
    interviewSession: {
      deps: { buildUseCase: () => ({ execute: vi.fn() }) },
    },
  });
}

// ── GET /interviews/:id/candidate-view ───────────────────────────────────────

describe("[Integration] CandidateInterviewController — GET /interviews/:id/candidate-view", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with the candidate view on happy path", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/candidate-view?token=valid-token`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ReturnType<typeof baseView>>();
    expect(body.interviewId).toBe(INTERVIEW_ID);
    expect(body.candidateName).toBe("Jane Doe");
    expect(body.jobTitle).toBe("Senior Backend Engineer");
    expect(body.company).toBe("Acme Corp");
    expect(body.targetDurationMinutes).toBe(45);
    expect(body.status).toBe("SCHEDULED");
    expect(typeof body.scheduledAt).toBe("string");
  });

  it("returns 401 when token query param is missing", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/candidate-view`,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("INVALID_CANDIDATE_TOKEN");
  });

  it("returns 401 when token signature is invalid", async () => {
    const deps = makeDeps({
      candidateLink: {
        verify: vi
          .fn()
          .mockReturnValue(Result.Err(new InvalidCandidateTokenError("bad signature"))),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/candidate-view?token=tampered-token`,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("INVALID_CANDIDATE_TOKEN");
  });

  it("returns 401 when token interviewId does not match path param", async () => {
    const deps = makeDeps({
      candidateLink: {
        verify: vi.fn().mockReturnValue(Result.Ok({ interviewId: OTHER_INTERVIEW_ID })),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/candidate-view?token=mismatched-token`,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("INVALID_CANDIDATE_TOKEN");
  });

  it("returns 404 when interview is not found", async () => {
    const deps = makeDeps({
      getCandidateInterviewViewUseCase: {
        execute: vi
          .fn()
          .mockResolvedValue(Result.Err(new InterviewNotFoundError(INTERVIEW_ID))),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/candidate-view?token=valid-token`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("INTERVIEW_NOT_FOUND");
  });

  it("does not call use case when token is missing", async () => {
    const executeSpy = vi.fn().mockResolvedValue(Result.Ok({ view: baseView() }));
    const deps = makeDeps({
      getCandidateInterviewViewUseCase: { execute: executeSpy },
    });
    app = await buildTestApp(deps);

    await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/candidate-view`,
    });

    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("does not require recruiter session — returns 200 without auth headers", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/candidate-view?token=valid-token`,
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns null targetDurationMinutes when interview has no plan", async () => {
    const deps = makeDeps({
      getCandidateInterviewViewUseCase: {
        execute: vi.fn().mockResolvedValue(
          Result.Ok({
            view: { ...baseView(), targetDurationMinutes: null, status: "CREATED" as const },
          }),
        ),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/candidate-view?token=valid-token`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ targetDurationMinutes: number | null }>();
    expect(body.targetDurationMinutes).toBeNull();
  });
});
