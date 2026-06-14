import { describe, expect, it } from "vitest";
import { JobDescription } from "./job-description.js";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";
import type { JobDescriptionProps } from "./job-description.js";

const baseProps = (overrides: Partial<JobDescriptionProps> = {}): JobDescriptionProps => ({
  title: "Senior Backend Engineer",
  company: "Acme Corp",
  responsibilities: ["Design APIs", "Write tests"],
  requirements: ["5+ years TypeScript", "PostgreSQL experience"],
  rawText: "We are looking for a senior backend engineer to join our team...",
  ...overrides,
});

describe("JobDescription", () => {
  describe("create()", () => {
    it("creates a valid JobDescription from complete valid props", () => {
      const result = JobDescription.create(baseProps());
      expect(result.isOk()).toBe(true);
      const jd = result.unwrap();
      expect(jd.title).toBe("Senior Backend Engineer");
      expect(jd.company).toBe("Acme Corp");
    });

    it("rejects empty title", () => {
      const result = JobDescription.create(baseProps({ title: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects whitespace-only title", () => {
      const result = JobDescription.create(baseProps({ title: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects empty company", () => {
      const result = JobDescription.create(baseProps({ company: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects whitespace-only company", () => {
      const result = JobDescription.create(baseProps({ company: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects empty rawText", () => {
      const result = JobDescription.create(baseProps({ rawText: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects whitespace-only rawText", () => {
      const result = JobDescription.create(baseProps({ rawText: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("accepts empty responsibilities array", () => {
      const result = JobDescription.create(baseProps({ responsibilities: [] }));
      expect(result.isOk()).toBe(true);
    });

    it("accepts empty requirements array", () => {
      const result = JobDescription.create(baseProps({ requirements: [] }));
      expect(result.isOk()).toBe(true);
    });
  });

  describe("serialize() / fromSerialized()", () => {
    it("round-trips without data loss", () => {
      const props = baseProps();
      const result = JobDescription.create(props);
      expect(result.isOk()).toBe(true);
      const jd = result.unwrap();
      const serialized = jd.serialize();
      const restored = JobDescription.fromSerialized(serialized);
      expect(restored.title).toBe(props.title);
      expect(restored.company).toBe(props.company);
      expect(restored.rawText).toBe(props.rawText);
      expect([...restored.responsibilities]).toEqual(props.responsibilities);
      expect([...restored.requirements]).toEqual(props.requirements);
    });

    it("serialize() returns all JobDescriptionProps fields", () => {
      const props = baseProps();
      const jd = JobDescription.fromSerialized(props);
      const serialized = jd.serialize();
      expect(serialized.title).toBe(props.title);
      expect(serialized.company).toBe(props.company);
      expect(serialized.rawText).toBe(props.rawText);
    });
  });
});
