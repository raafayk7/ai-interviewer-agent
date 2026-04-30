import { describe, expect, it } from "vitest";
import { InterviewStatusPolicy, INTERVIEW_STATUS } from "./interview-status.js";

describe("InterviewStatusPolicy", () => {
  describe("canTransition()", () => {
    it("allows CREATED → SCHEDULED", () => {
      expect(InterviewStatusPolicy.canTransition(INTERVIEW_STATUS.CREATED, INTERVIEW_STATUS.SCHEDULED)).toBe(true);
    });

    it("allows SCHEDULED → IN_PROGRESS", () => {
      expect(InterviewStatusPolicy.canTransition(INTERVIEW_STATUS.SCHEDULED, INTERVIEW_STATUS.IN_PROGRESS)).toBe(true);
    });

    it("allows IN_PROGRESS → COMPLETED", () => {
      expect(InterviewStatusPolicy.canTransition(INTERVIEW_STATUS.IN_PROGRESS, INTERVIEW_STATUS.COMPLETED)).toBe(true);
    });

    it("allows IN_PROGRESS → CANCELLED", () => {
      expect(InterviewStatusPolicy.canTransition(INTERVIEW_STATUS.IN_PROGRESS, INTERVIEW_STATUS.CANCELLED)).toBe(true);
    });

    it("allows COMPLETED → EVALUATED", () => {
      expect(InterviewStatusPolicy.canTransition(INTERVIEW_STATUS.COMPLETED, INTERVIEW_STATUS.EVALUATED)).toBe(true);
    });

    it("disallows CREATED → IN_PROGRESS", () => {
      expect(InterviewStatusPolicy.canTransition(INTERVIEW_STATUS.CREATED, INTERVIEW_STATUS.IN_PROGRESS)).toBe(false);
    });

    it("disallows SCHEDULED → CANCELLED", () => {
      expect(InterviewStatusPolicy.canTransition(INTERVIEW_STATUS.SCHEDULED, INTERVIEW_STATUS.CANCELLED)).toBe(false);
    });

    it("disallows EVALUATED → COMPLETED", () => {
      expect(InterviewStatusPolicy.canTransition(INTERVIEW_STATUS.EVALUATED, INTERVIEW_STATUS.COMPLETED)).toBe(false);
    });

    it("disallows EVALUATED → CREATED", () => {
      expect(InterviewStatusPolicy.canTransition(INTERVIEW_STATUS.EVALUATED, INTERVIEW_STATUS.CREATED)).toBe(false);
    });

    it("disallows CANCELLED → IN_PROGRESS", () => {
      expect(InterviewStatusPolicy.canTransition(INTERVIEW_STATUS.CANCELLED, INTERVIEW_STATUS.IN_PROGRESS)).toBe(false);
    });

    it("disallows CANCELLED → CREATED", () => {
      expect(InterviewStatusPolicy.canTransition(INTERVIEW_STATUS.CANCELLED, INTERVIEW_STATUS.CREATED)).toBe(false);
    });
  });

  describe("isTerminal()", () => {
    it("returns true for EVALUATED", () => {
      expect(InterviewStatusPolicy.isTerminal(INTERVIEW_STATUS.EVALUATED)).toBe(true);
    });

    it("returns true for CANCELLED", () => {
      expect(InterviewStatusPolicy.isTerminal(INTERVIEW_STATUS.CANCELLED)).toBe(true);
    });

    it("returns false for CREATED", () => {
      expect(InterviewStatusPolicy.isTerminal(INTERVIEW_STATUS.CREATED)).toBe(false);
    });

    it("returns false for SCHEDULED", () => {
      expect(InterviewStatusPolicy.isTerminal(INTERVIEW_STATUS.SCHEDULED)).toBe(false);
    });

    it("returns false for IN_PROGRESS", () => {
      expect(InterviewStatusPolicy.isTerminal(INTERVIEW_STATUS.IN_PROGRESS)).toBe(false);
    });

    it("returns false for COMPLETED", () => {
      expect(InterviewStatusPolicy.isTerminal(INTERVIEW_STATUS.COMPLETED)).toBe(false);
    });
  });
});
