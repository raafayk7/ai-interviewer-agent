import { describe, expect, it } from "vitest";
import { CandidateInfo } from "./candidate-info.js";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";
import type { CandidateInfoProps } from "./candidate-info.js";

const baseProps = (overrides: Partial<CandidateInfoProps> = {}): CandidateInfoProps => ({
  fullName: "Jane Doe",
  email: "jane.doe@example.com",
  headline: "Senior Backend Engineer",
  yearsOfExperience: 5,
  skills: ["TypeScript", "Node.js", "PostgreSQL"],
  education: ["B.Sc. Computer Science, MIT 2018"],
  rawText: "Jane Doe is an experienced backend engineer...",
  ...overrides,
});

describe("CandidateInfo", () => {
  describe("create()", () => {
    it("creates a valid CandidateInfo from complete valid props", () => {
      const result = CandidateInfo.create(baseProps());
      expect(result.isOk()).toBe(true);
      const info = result.unwrap();
      expect(info.fullName).toBe("Jane Doe");
      expect(info.email).toBe("jane.doe@example.com");
    });

    it("rejects empty fullName", () => {
      const result = CandidateInfo.create(baseProps({ fullName: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects whitespace-only fullName", () => {
      const result = CandidateInfo.create(baseProps({ fullName: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects malformed email — missing @ symbol", () => {
      const result = CandidateInfo.create(baseProps({ email: "not-an-email" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects malformed email — missing domain", () => {
      const result = CandidateInfo.create(baseProps({ email: "user@" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects malformed email — missing TLD", () => {
      const result = CandidateInfo.create(baseProps({ email: "user@domain" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects negative yearsOfExperience", () => {
      const result = CandidateInfo.create(baseProps({ yearsOfExperience: -1 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("accepts zero yearsOfExperience (fresh graduate)", () => {
      const result = CandidateInfo.create(baseProps({ yearsOfExperience: 0 }));
      expect(result.isOk()).toBe(true);
    });

    it("skills array is frozen — original mutation does not affect stored value", () => {
      const skills = ["TypeScript", "Node.js"];
      const result = CandidateInfo.create(baseProps({ skills }));
      expect(result.isOk()).toBe(true);
      const info = result.unwrap();
      // The stored array is frozen; its length cannot change
      expect(Object.isFrozen(info.skills)).toBe(true);
    });

    it("education array is frozen — original mutation does not affect stored value", () => {
      const education = ["B.Sc. CS"];
      const result = CandidateInfo.create(baseProps({ education }));
      expect(result.isOk()).toBe(true);
      const info = result.unwrap();
      expect(Object.isFrozen(info.education)).toBe(true);
    });
  });

  describe("serialize() / fromSerialized()", () => {
    it("round-trips without data loss", () => {
      const props = baseProps();
      const result = CandidateInfo.create(props);
      expect(result.isOk()).toBe(true);
      const info = result.unwrap();
      const serialized = info.serialize();
      const restored = CandidateInfo.fromSerialized(serialized);
      expect(restored.fullName).toBe(props.fullName);
      expect(restored.email).toBe(props.email);
      expect(restored.headline).toBe(props.headline);
      expect(restored.yearsOfExperience).toBe(props.yearsOfExperience);
      expect([...restored.skills]).toEqual(props.skills);
      expect([...restored.education]).toEqual(props.education);
      expect(restored.rawText).toBe(props.rawText);
    });
  });
});
