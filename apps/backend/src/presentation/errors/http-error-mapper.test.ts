import { describe, expect, it } from "vitest";
import {
  DtoValidationError,
  InvalidCandidateTokenError,
  ServiceUnknownError,
  UnauthorizedError,
  ForbiddenError,
  ServiceUnavailableError,
  ServiceTimeoutError,
} from "@repo/application";
import type { ServiceError } from "@repo/application";
import {
  mapServiceErrorToHttp,
} from "./http-error-mapper.js";

// Minimal ServiceError-shaped object for codes not represented by a real class
function makeError(code: string, message = "test error"): ServiceError {
  return Object.assign(new Error(message), { code, name: "TestError" }) as ServiceError;
}

describe("mapServiceErrorToHttp", () => {
  describe("known 404 codes", () => {
    it("maps INTERVIEW_NOT_FOUND → 404", () => {
      const { status } = mapServiceErrorToHttp(makeError("INTERVIEW_NOT_FOUND"));
      expect(status).toBe(404);
    });

    it("maps REPORT_NOT_FOUND → 404", () => {
      const { status } = mapServiceErrorToHttp(makeError("REPORT_NOT_FOUND"));
      expect(status).toBe(404);
    });

    it("maps STORAGE_NOT_FOUND → 404", () => {
      const { status } = mapServiceErrorToHttp(makeError("STORAGE_NOT_FOUND"));
      expect(status).toBe(404);
    });
  });

  describe("known 400 codes", () => {
    it("maps INVALID_INTERVIEW_INPUT → 400", () => {
      const { status } = mapServiceErrorToHttp(makeError("INVALID_INTERVIEW_INPUT"));
      expect(status).toBe(400);
    });

    it("maps INVALID_REPORT_INPUT → 400", () => {
      const { status } = mapServiceErrorToHttp(makeError("INVALID_REPORT_INPUT"));
      expect(status).toBe(400);
    });

    it("maps INVALID_FILE_REF → 400", () => {
      const { status } = mapServiceErrorToHttp(makeError("INVALID_FILE_REF"));
      expect(status).toBe(400);
    });

    it("maps DTO_VALIDATION_FAILED → 400", () => {
      const { status } = mapServiceErrorToHttp(makeError("DTO_VALIDATION_FAILED"));
      expect(status).toBe(400);
    });
  });

  describe("known 401 codes", () => {
    it("maps UNAUTHORIZED → 401 (using UnauthorizedError class)", () => {
      const { status } = mapServiceErrorToHttp(new UnauthorizedError());
      expect(status).toBe(401);
    });

    it("maps INVALID_CANDIDATE_TOKEN → 401 (using InvalidCandidateTokenError class)", () => {
      const { status } = mapServiceErrorToHttp(new InvalidCandidateTokenError());
      expect(status).toBe(401);
    });
  });

  describe("known 403 codes", () => {
    it("maps FORBIDDEN → 403 (using ForbiddenError class)", () => {
      const { status } = mapServiceErrorToHttp(new ForbiddenError());
      expect(status).toBe(403);
    });
  });

  describe("known 409 codes", () => {
    it("maps INVALID_INTERVIEW_STATE_TRANSITION → 409", () => {
      const { status } = mapServiceErrorToHttp(makeError("INVALID_INTERVIEW_STATE_TRANSITION"));
      expect(status).toBe(409);
    });

    it("maps INTERVIEW_PLAN_REQUIRED → 409", () => {
      const { status } = mapServiceErrorToHttp(makeError("INTERVIEW_PLAN_REQUIRED"));
      expect(status).toBe(409);
    });

    it("maps SESSION_ALREADY_ACTIVE → 409", () => {
      const { status } = mapServiceErrorToHttp(makeError("SESSION_ALREADY_ACTIVE"));
      expect(status).toBe(409);
    });

    it("maps TRANSCRIPT_NOT_STRICTLY_BETTER → 409", () => {
      const { status } = mapServiceErrorToHttp(makeError("TRANSCRIPT_NOT_STRICTLY_BETTER"));
      expect(status).toBe(409);
    });
  });

  describe("known 422 codes", () => {
    it("maps PLANNER_OUTPUT_INVALID → 422", () => {
      const { status } = mapServiceErrorToHttp(makeError("PLANNER_OUTPUT_INVALID"));
      expect(status).toBe(422);
    });

    it("maps EXTRACTION_PARSE_FAILED → 422", () => {
      const { status } = mapServiceErrorToHttp(makeError("EXTRACTION_PARSE_FAILED"));
      expect(status).toBe(422);
    });

    it("maps EVALUATOR_OUTPUT_INVALID → 422", () => {
      const { status } = mapServiceErrorToHttp(makeError("EVALUATOR_OUTPUT_INVALID"));
      expect(status).toBe(422);
    });
  });

  describe("known 503 codes", () => {
    it("maps SERVICE_UNAVAILABLE → 503 (using ServiceUnavailableError class)", () => {
      const { status } = mapServiceErrorToHttp(new ServiceUnavailableError("down"));
      expect(status).toBe(503);
    });

    it("maps SERVICE_TIMEOUT → 503 (using ServiceTimeoutError class)", () => {
      const { status } = mapServiceErrorToHttp(new ServiceTimeoutError("timed out"));
      expect(status).toBe(503);
    });

    it("maps STORAGE_UNAVAILABLE → 503", () => {
      const { status } = mapServiceErrorToHttp(makeError("STORAGE_UNAVAILABLE"));
      expect(status).toBe(503);
    });

    it("maps PLANNER_UNAVAILABLE → 503", () => {
      const { status } = mapServiceErrorToHttp(makeError("PLANNER_UNAVAILABLE"));
      expect(status).toBe(503);
    });

    it("maps EVALUATOR_UNAVAILABLE → 503", () => {
      const { status } = mapServiceErrorToHttp(makeError("EVALUATOR_UNAVAILABLE"));
      expect(status).toBe(503);
    });

    it("maps AGENT_UNAVAILABLE → 503", () => {
      const { status } = mapServiceErrorToHttp(makeError("AGENT_UNAVAILABLE"));
      expect(status).toBe(503);
    });

    it("maps STT_UNAVAILABLE → 503", () => {
      const { status } = mapServiceErrorToHttp(makeError("STT_UNAVAILABLE"));
      expect(status).toBe(503);
    });

    it("maps TTS_UNAVAILABLE → 503", () => {
      const { status } = mapServiceErrorToHttp(makeError("TTS_UNAVAILABLE"));
      expect(status).toBe(503);
    });

    it("maps EXTRACTION_UNAVAILABLE → 503", () => {
      const { status } = mapServiceErrorToHttp(makeError("EXTRACTION_UNAVAILABLE"));
      expect(status).toBe(503);
    });
  });

  describe("known 504 codes", () => {
    it("maps AGENT_TURN_TIMEOUT → 504", () => {
      const { status } = mapServiceErrorToHttp(makeError("AGENT_TURN_TIMEOUT"));
      expect(status).toBe(504);
    });
  });

  describe("unknown codes fall back to 500", () => {
    it("maps an unknown code string → 500", () => {
      const { status } = mapServiceErrorToHttp(makeError("COMPLETELY_UNKNOWN_ERROR_XYZ"));
      expect(status).toBe(500);
    });

    it("maps SERVICE_UNKNOWN_ERROR (ServiceUnknownError class) → 500", () => {
      const { status } = mapServiceErrorToHttp(new ServiceUnknownError("oops", "someOp"));
      expect(status).toBe(500);
    });
  });

  describe("error body shape", () => {
    it("returns body with error.code and error.message", () => {
      const { body } = mapServiceErrorToHttp(makeError("INTERVIEW_NOT_FOUND", "not found"));
      expect(body.error.code).toBe("INTERVIEW_NOT_FOUND");
      expect(body.error.message).toBe("not found");
    });

    it("does not include issues for non-DTO errors", () => {
      const { body } = mapServiceErrorToHttp(makeError("INTERVIEW_NOT_FOUND"));
      expect(body.error.issues).toBeUndefined();
    });
  });

  describe("DtoValidationError includes issues array", () => {
    it("returns 400 with issues when a DtoValidationError is mapped", () => {
      const err = new DtoValidationError("validation failed", [
        { path: ["email"], message: "Invalid email" },
        { path: ["name"], message: "Required" },
      ]);

      const { status, body } = mapServiceErrorToHttp(err);

      expect(status).toBe(400);
      expect(body.error.code).toBe("DTO_VALIDATION_FAILED");
      expect(body.error.issues).toBeDefined();
      expect(body.error.issues).toHaveLength(2);
      expect(body.error.issues![0]).toEqual({ path: ["email"], message: "Invalid email" });
      expect(body.error.issues![1]).toEqual({ path: ["name"], message: "Required" });
    });

    it("returns issues as empty array when DtoValidationError has no issues", () => {
      const err = new DtoValidationError("no issues", []);

      const { body } = mapServiceErrorToHttp(err);

      expect(body.error.issues).toBeDefined();
      expect(body.error.issues).toHaveLength(0);
    });
  });
});
