import { describe, expect, it } from "vitest";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";
import { AgentInternalScore } from "./agent-internal-score.js";
import type { AgentInternalScoreProps } from "./agent-internal-score.js";

const baseProps = (overrides: Partial<AgentInternalScoreProps> = {}): AgentInternalScoreProps => ({
  topicName: "System Design",
  score: 4,
  justification: "Clear trade-off discussion with some depth on scaling.",
  recordedAtTurn: 3,
  recordedAt: new Date("2025-01-01T10:05:00Z"),
  ...overrides,
});

describe("AgentInternalScore", () => {
  describe("create()", () => {
    it("creates a valid internal score", () => {
      const result = AgentInternalScore.create(baseProps());
      expect(result.isOk()).toBe(true);
      const score = result.unwrap();
      expect(score.topicName).toBe("System Design");
      expect(score.score).toBe(4);
    });

    it("rejects empty topicName", () => {
      const result = AgentInternalScore.create(baseProps({ topicName: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects empty justification", () => {
      const result = AgentInternalScore.create(baseProps({ justification: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects score below 0", () => {
      const result = AgentInternalScore.create(baseProps({ score: -1 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects score above 5", () => {
      const result = AgentInternalScore.create(baseProps({ score: 6 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects non-finite score", () => {
      const result = AgentInternalScore.create(baseProps({ score: Number.POSITIVE_INFINITY }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects fractional recordedAtTurn", () => {
      const result = AgentInternalScore.create(baseProps({ recordedAtTurn: 2.5 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects negative recordedAtTurn", () => {
      const result = AgentInternalScore.create(baseProps({ recordedAtTurn: -1 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });
  });

  describe("serialize() / fromSerialized()", () => {
    it("round-trips without data loss", () => {
      const props = baseProps();
      const result = AgentInternalScore.create(props);
      expect(result.isOk()).toBe(true);
      const serialized = result.unwrap().serialize();
      const restored = AgentInternalScore.fromSerialized(serialized);

      expect(restored.topicName).toBe(props.topicName);
      expect(restored.score).toBe(props.score);
      expect(restored.justification).toBe(props.justification);
      expect(restored.recordedAtTurn).toBe(props.recordedAtTurn);
      expect(restored.recordedAt).toEqual(props.recordedAt);
    });
  });
});
