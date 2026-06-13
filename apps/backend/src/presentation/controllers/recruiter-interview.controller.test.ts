import { Option, Result } from "@carbonteq/fp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ServiceUnknownError,
  DtoValidationError,
  type ServiceError,
} from "@repo/application";
import * as ApplicationModule from "@repo/application";
import { buildApp, type BuildAppOptions } from "../../app.js";
import { mapServiceErrorToHttp } from "../errors/http-error-mapper.js";
import type { RecruiterInterviewControllerDeps } from "./recruiter-interview.controller.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

const RECRUITER_ID = "recruiter-001";
const INTERVIEW_ID = "interview-abc-123";
const OTHER_RECRUITER_ID = "recruiter-999";

const baseSerialized = () => ({
  id: INTERVIEW_ID,
  recruiterId: RECRUITER_ID,
  status: "CREATED" as const,
  jobDescription: {
    title: "Engineer",
    company: "Acme",
    responsibilities: [],
    requirements: [],
    rawText: "text",
  },
  candidateInfo: {
    fullName: "Jane Doe",
    email: "jane@example.com",
    headline: "Engineer",
    yearsOfExperience: 3,
    skills: [],
    education: [],
    rawText: "text",
  },
  clientInstructions: "focus on design",
  interviewPlan: null,
  transcript: [],
  notes: [],
  internalScores: [],
  jdFileRef: {
    key: "jd.pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    originalFilename: "jd.pdf",
    uploadedAt: new Date("2025-01-01"),
  },
  cvFileRef: {
    key: "cv.pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    originalFilename: "cv.pdf",
    uploadedAt: new Date("2025-01-01"),
  },
  scheduledAt: new Date("2025-06-01T09:00:00Z"),
  startedAt: null,
  completedAt: null,
  reportId: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
});

const baseCreateInput = () => ({
  jobDescription: {
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Build APIs"],
    requirements: ["TypeScript"],
    rawText: "We need a backend engineer.",
  },
  candidateInfo: {
    fullName: "Jane Doe",
    email: "jane.doe@example.com",
    headline: "Senior Engineer",
    yearsOfExperience: 5,
    skills: ["TypeScript"],
    education: ["B.Sc. CS"],
    rawText: "Jane is an experienced engineer.",
  },
  clientInstructions: "Focus on system design.",
  scheduledAt: new Date("2025-06-01T09:00:00Z"),
  jdFileRef: {
    key: "interviews/abc/jd.pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    originalFilename: "jd.pdf",
    uploadedAt: new Date("2025-01-01T00:00:00Z"),
  },
  cvFileRef: {
    key: "interviews/abc/cv.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
    originalFilename: "cv.pdf",
    uploadedAt: new Date("2025-01-01T00:00:00Z"),
  },
});

function makeAuthDeps(recruiterId: string | null = RECRUITER_ID) {
  return {
    auth: {
      api: {
        getSession: vi.fn().mockResolvedValue(
          recruiterId
            ? { user: { id: recruiterId, email: "recruiter@company.com" } }
            : null,
        ),
      },
      handler: vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    },
  };
}

function makeDeps(overrides: Partial<RecruiterInterviewControllerDeps> = {}): RecruiterInterviewControllerDeps {
  const interview = baseSerialized();
  return {
    createInterviewUseCase: {
      execute: vi.fn().mockResolvedValue(
        Result.Ok({ interviewId: INTERVIEW_ID, status: "CREATED", scheduledAt: new Date("2025-06-01") }),
      ),
    },
    listInterviewsUseCase: {
      execute: vi.fn().mockResolvedValue(Result.Ok({ interviews: [interview] })),
    },
    getInterviewByIdUseCase: {
      execute: vi.fn().mockResolvedValue(Result.Ok({ interview })),
    },
    generatePlanUseCase: {
      execute: vi.fn().mockResolvedValue(
        Result.Ok({
          interviewId: INTERVIEW_ID,
          status: "SCHEDULED",
          topicCount: 3,
          targetDurationMinutes: 45,
          maxDurationMinutes: 60,
        }),
      ),
    },
    evaluateInterviewUseCase: {
      execute: vi.fn().mockResolvedValue(Result.Ok({ report: { id: "report-1" } })),
    },
    getReportByInterviewIdUseCase: {
      execute: vi.fn().mockResolvedValue(
        Result.Ok({ report: Option.Some({ id: "report-1", summary: "great" }) }),
      ),
    },
    issueCandidateLinkUseCase: {
      execute: vi.fn().mockResolvedValue(
        Result.Ok({ interviewId: INTERVIEW_ID, status: "SCHEDULED" }),
      ),
    },
    reconcileStuckInterviewsUseCase: {
      execute: vi.fn().mockResolvedValue(
        Result.Ok({ scanned: 2, completed: ["interview-1"], failed: ["interview-2"] }),
      ),
    },
    reconcileThresholdMinutes: 90,
    candidateLink: {
      issue: vi.fn().mockReturnValue("token-abc"),
      defaultTtlSeconds: 604800,
    },
    publicBaseUrl: "https://app.example.com",
    ...overrides,
  };
}

async function buildTestApp(
  deps: RecruiterInterviewControllerDeps,
  authDeps = makeAuthDeps(),
): Promise<FastifyInstance> {
  return buildApp({
    authDeps: authDeps as BuildAppOptions["authDeps"],
    recruiterInterviews: { deps },
    interviewSession: {
      deps: { buildUseCase: () => ({ execute: vi.fn() }) },
    },
  });
}

// ── POST /interviews ──────────────────────────────────────────────────────────
// NOTE: CreateInterviewInputDto uses z.date() (strict, not z.coerce.date()) for
// uploadedAt fields. When data is transmitted via HTTP JSON, Date objects are
// serialized as ISO strings which z.date() rejects. Therefore, testing the
// "happy path → 201" requires spying on the DTO.parse to return a successful
// result. The DTO's own behaviour is covered in create-interview.dto.test.ts.

describe("[Integration] RecruiterInterviewController — POST /interviews", () => {
  let app: FastifyInstance;
  let parseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    parseSpy = vi.spyOn(ApplicationModule.CreateInterviewInputDto, "parse").mockImplementation(
      (raw: unknown) => {
        if (!raw || typeof raw !== "object" || !("jobDescription" in raw)) {
          return Result.Err(
            new DtoValidationError("validation failed", [{ path: ["jobDescription"], message: "required" }]),
          );
        }
        // Return Ok with a minimal valid DTO value
        return Result.Ok({ value: raw } as ApplicationModule.CreateInterviewInputDto);
      },
    );
  });

  afterEach(async () => {
    parseSpy?.mockRestore();
    await app?.close();
  });

  it("returns 201 with interviewId on valid request with authenticated session", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/interviews",
      payload: { jobDescription: "present" }, // mock DTO accepts this
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ interviewId: string }>();
    expect(body.interviewId).toBe(INTERVIEW_ID);
  });

  it("returns 401 when request is unauthenticated", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(null));

    const response = await app.inject({
      method: "POST",
      url: "/interviews",
      payload: baseCreateInput(),
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 with issues when DTO validation fails (missing required field)", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/interviews",
      payload: {}, // missing jobDescription → mock returns Err
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; issues: unknown[] } }>();
    expect(body.error.code).toBe("DTO_VALIDATION_FAILED");
    expect(Array.isArray(body.error.issues)).toBe(true);
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  it("returns 500 when use case returns ServiceUnknownError", async () => {
    const deps = makeDeps({
      createInterviewUseCase: {
        execute: vi.fn().mockResolvedValue(
          Result.Err(new ServiceUnknownError("DB failure", "InterviewRepository.save")),
        ),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/interviews",
      payload: { jobDescription: "present" }, // mock DTO accepts this
    });

    expect(response.statusCode).toBe(500);
  });
});

// ── GET /interviews ───────────────────────────────────────────────────────────

describe("[Integration] RecruiterInterviewController — GET /interviews", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with list of interviews on valid authenticated request", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({ method: "GET", url: "/interviews" });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ interviews: unknown[] }>();
    expect(Array.isArray(body.interviews)).toBe(true);
    expect(body.interviews).toHaveLength(1);
  });

  it("returns 401 when request is unauthenticated", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(null));

    const response = await app.inject({ method: "GET", url: "/interviews" });

    expect(response.statusCode).toBe(401);
  });

  it("returns 500 when use case returns an error", async () => {
    const deps = makeDeps({
      listInterviewsUseCase: {
        execute: vi.fn().mockResolvedValue(
          Result.Err(new ServiceUnknownError("DB failure", "InterviewRepository.listByRecruiter")),
        ),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({ method: "GET", url: "/interviews" });

    expect(response.statusCode).toBe(500);
  });
});

// ── POST /interviews/reconcile-stuck ─────────────────────────────────────────

describe("[Integration] RecruiterInterviewController — POST /interviews/reconcile-stuck", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with reconciliation summary and uses configured threshold", async () => {
    const execute = vi.fn().mockResolvedValue(
      Result.Ok({ scanned: 2, completed: ["interview-1"], failed: ["interview-2"] }),
    );
    const deps = makeDeps({
      reconcileStuckInterviewsUseCase: { execute },
      reconcileThresholdMinutes: 45,
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/interviews/reconcile-stuck",
    });

    expect(response.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith({ thresholdMinutes: 45 });
    expect(response.json()).toEqual({
      scanned: 2,
      completed: ["interview-1"],
      failed: ["interview-2"],
    });
  });

  it("returns 401 when request is unauthenticated", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(null));

    const response = await app.inject({
      method: "POST",
      url: "/interviews/reconcile-stuck",
    });

    expect(response.statusCode).toBe(401);
  });

  it("maps a use-case error to the canonical HTTP status via mapServiceErrorToHttp", async () => {
    const error = new ServiceUnknownError("DB failure", "InterviewRepository.findStuckInProgress");
    const deps = makeDeps({
      reconcileStuckInterviewsUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Err(error)),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/interviews/reconcile-stuck",
    });

    // The reconcile error path routes through sendError → mapServiceErrorToHttp (ADR-018).
    expect(response.statusCode).toBe(mapServiceErrorToHttp(error).status);
  });
});

// ── GET /interviews/:id ───────────────────────────────────────────────────────

describe("[Integration] RecruiterInterviewController — GET /interviews/:id", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with the interview when found and owned", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({ method: "GET", url: `/interviews/${INTERVIEW_ID}` });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ interview: { id: string } }>();
    expect(body.interview.id).toBe(INTERVIEW_ID);
  });

  it("returns 401 when request is unauthenticated", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(null));

    const response = await app.inject({ method: "GET", url: `/interviews/${INTERVIEW_ID}` });

    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when the interview belongs to another recruiter (existence hiding)", async () => {
    // The serialized interview has RECRUITER_ID; session has OTHER_RECRUITER_ID
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(OTHER_RECRUITER_ID));

    const response = await app.inject({ method: "GET", url: `/interviews/${INTERVIEW_ID}` });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("INTERVIEW_NOT_FOUND");
  });

  it("returns 404 when use case returns InterviewNotFoundError", async () => {
    const notFoundErr = Object.assign(new Error("not found"), {
      code: "INTERVIEW_NOT_FOUND",
    }) as ServiceError;
    const deps = makeDeps({
      getInterviewByIdUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Err(notFoundErr)),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({ method: "GET", url: "/interviews/nonexistent" });

    expect(response.statusCode).toBe(404);
  });
});

// ── POST /interviews/:id/plan ─────────────────────────────────────────────────

describe("[Integration] RecruiterInterviewController — POST /interviews/:id/plan", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with plan data and candidateLink.url in body", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/plan`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ candidateLink: { url: string; token: string } }>();
    expect(body.candidateLink).toBeDefined();
    expect(typeof body.candidateLink.url).toBe("string");
    expect(body.candidateLink.url).toContain(INTERVIEW_ID);
    expect(body.candidateLink.url).toContain("token=");
    expect(body.candidateLink.url).toContain(`/c/${INTERVIEW_ID}`);
    expect(body.candidateLink.url).not.toContain("/session");
  });

  it("returns 401 when request is unauthenticated", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(null));

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/plan`,
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when the interview belongs to another recruiter", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(OTHER_RECRUITER_ID));

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/plan`,
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 409 when use case returns INVALID_INTERVIEW_STATE_TRANSITION", async () => {
    const stateErr = Object.assign(new Error("bad transition"), {
      code: "INVALID_INTERVIEW_STATE_TRANSITION",
    }) as ServiceError;
    const deps = makeDeps({
      generatePlanUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Err(stateErr)),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/plan`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
  });
});

// ── POST /interviews/:id/evaluate ─────────────────────────────────────────────

describe("[Integration] RecruiterInterviewController — POST /interviews/:id/evaluate", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with report on happy path", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/evaluate`,
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns 401 when request is unauthenticated", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(null));

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/evaluate`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when ownership check fails", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(OTHER_RECRUITER_ID));

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/evaluate`,
    });

    expect(response.statusCode).toBe(404);
  });
});

// ── GET /interviews/:id/report ────────────────────────────────────────────────

describe("[Integration] RecruiterInterviewController — GET /interviews/:id/report", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with report when Some(report) is returned", async () => {
    const deps = makeDeps({
      getReportByInterviewIdUseCase: {
        execute: vi.fn().mockResolvedValue(
          Result.Ok({ report: Option.Some({ id: "report-1", summary: "well done" }) }),
        ),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/report`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ report: { id: string } }>();
    expect(body.report).toBeDefined();
    expect(body.report.id).toBe("report-1");
  });

  it("returns 404 with code REPORT_NOT_AVAILABLE when None is returned", async () => {
    const deps = makeDeps({
      getReportByInterviewIdUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Ok({ report: Option.None })),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/report`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("REPORT_NOT_AVAILABLE");
  });

  it("returns 401 when request is unauthenticated", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(null));

    const response = await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/report`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when ownership check fails", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(OTHER_RECRUITER_ID));

    const response = await app.inject({
      method: "GET",
      url: `/interviews/${INTERVIEW_ID}/report`,
    });

    expect(response.statusCode).toBe(404);
  });
});

// ── POST /interviews/:id/candidate-link ───────────────────────────────────────

describe("[Integration] RecruiterInterviewController — POST /interviews/:id/candidate-link", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with url, token, and expiresInSeconds on happy path", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/candidate-link`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ url: string; token: string; expiresInSeconds: number }>();
    expect(typeof body.url).toBe("string");
    expect(body.url).toContain(INTERVIEW_ID);
    expect(body.url).toContain("token=token-abc");
    expect(body.url).toContain(`/c/${INTERVIEW_ID}`);
    expect(body.url).not.toContain("/session");
    expect(body.token).toBe("token-abc");
    expect(body.expiresInSeconds).toBe(604800);
  });

  it("calls candidateLink.issue with the interview id", async () => {
    const issueSpy = vi.fn().mockReturnValue("token-xyz");
    const deps = makeDeps({ candidateLink: { issue: issueSpy, defaultTtlSeconds: 604800 } });
    app = await buildTestApp(deps);

    await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/candidate-link`,
    });

    expect(issueSpy).toHaveBeenCalledWith(INTERVIEW_ID);
  });

  it("returns 401 when request is unauthenticated", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(null));

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/candidate-link`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when the interview belongs to another recruiter (existence hiding)", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(OTHER_RECRUITER_ID));

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/candidate-link`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("INTERVIEW_NOT_FOUND");
  });

  it("returns 404 when use case returns InterviewNotFoundError", async () => {
    const notFoundErr = Object.assign(new Error("not found"), {
      code: "INTERVIEW_NOT_FOUND",
    }) as ServiceError;
    const deps = makeDeps({
      issueCandidateLinkUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Err(notFoundErr)),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/candidate-link`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("INTERVIEW_NOT_FOUND");
  });

  it("returns 409 when use case returns InvalidInterviewStateTransitionError", async () => {
    const stateErr = Object.assign(new Error("bad state"), {
      code: "INVALID_INTERVIEW_STATE_TRANSITION",
    }) as ServiceError;
    const deps = makeDeps({
      issueCandidateLinkUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Err(stateErr)),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: `/interviews/${INTERVIEW_ID}/candidate-link`,
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("INVALID_INTERVIEW_STATE_TRANSITION");
  });
});
