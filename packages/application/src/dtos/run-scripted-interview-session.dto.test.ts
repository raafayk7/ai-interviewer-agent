import { describe, expect, it } from "vitest";
import { DtoValidationError } from "../core/base-dto.js";
import { RunScriptedInterviewSessionInputDto } from "./run-scripted-interview-session.dto.js";

describe("RunScriptedInterviewSessionInputDto", () => {
  describe("parse()", () => {
    it("returns Ok for a valid interviewId", () => {
      const result = RunScriptedInterviewSessionInputDto.parse({
        interviewId: "interview-001",
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().value).toEqual({ interviewId: "interview-001" });
    });

    it("returns Err for an empty interviewId", () => {
      const result = RunScriptedInterviewSessionInputDto.parse({ interviewId: "" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err for non-object input", () => {
      const result = RunScriptedInterviewSessionInputDto.parse("interview-001");

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });
  });
});
