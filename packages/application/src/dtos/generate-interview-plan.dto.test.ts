import { describe, expect, it } from "vitest";
import { GenerateInterviewPlanInputDto } from "./generate-interview-plan.dto.js";
import { DtoValidationError } from "../core/base-dto.js";

const validInput = () => ({
  interviewId: "interview-001",
  targetDurationMinutes: 45,
  maxDurationMinutes: 60,
});

describe("GenerateInterviewPlanInputDto", () => {
  describe("parse()", () => {
    it("returns Ok for valid input with duration overrides", () => {
      const result = GenerateInterviewPlanInputDto.parse(validInput());
      expect(result.isOk()).toBe(true);
      const dto = result.unwrap();
      expect(dto.value.interviewId).toBe("interview-001");
      expect(dto.value.targetDurationMinutes).toBe(45);
      expect(dto.value.maxDurationMinutes).toBe(60);
    });

    it("returns Ok when duration overrides are omitted", () => {
      const result = GenerateInterviewPlanInputDto.parse({ interviewId: "interview-001" });
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().value.interviewId).toBe("interview-001");
    });

    it("returns Err when interviewId is empty", () => {
      const input = { ...validInput(), interviewId: "" };
      const result = GenerateInterviewPlanInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err when targetDurationMinutes is not positive", () => {
      const input = { ...validInput(), targetDurationMinutes: 0 };
      const result = GenerateInterviewPlanInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err when maxDurationMinutes is not an integer", () => {
      const input = { ...validInput(), maxDurationMinutes: 60.5 };
      const result = GenerateInterviewPlanInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err when maxDurationMinutes is less than targetDurationMinutes", () => {
      const input = { ...validInput(), targetDurationMinutes: 75, maxDurationMinutes: 60 };
      const result = GenerateInterviewPlanInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });
  });
});
