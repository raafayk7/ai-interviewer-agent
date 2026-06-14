import { describe, expect, it } from "vitest";
import { DtoValidationError } from "../core/base-dto.js";
import { EvaluateInterviewInputDto } from "./evaluate-interview.dto.js";

describe("EvaluateInterviewInputDto", () => {
  describe("parse()", () => {
    it("returns Ok for valid input", () => {
      const result = EvaluateInterviewInputDto.parse({ interviewId: "interview-001" });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().value).toEqual({ interviewId: "interview-001" });
    });

    it("returns Err when interviewId is empty", () => {
      const result = EvaluateInterviewInputDto.parse({ interviewId: "" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err when interviewId is missing", () => {
      const result = EvaluateInterviewInputDto.parse({});

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });
  });
});
