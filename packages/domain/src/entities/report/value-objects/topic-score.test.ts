import { describe, expect, it } from "vitest";
import { TopicScore } from "./topic-score.js";
import { InvalidReportInputError } from "../errors/report.errors.js";
import type { TopicScoreProps } from "./topic-score.js";

const baseProps = (overrides: Partial<TopicScoreProps> = {}): TopicScoreProps => ({
  topicName: "System Design",
  score: 4,
  justification: "Candidate demonstrated strong understanding of distributed systems.",
  ...overrides,
});

describe("TopicScore", () => {
  describe("create()", () => {
    it("creates a valid TopicScore from complete valid props", () => {
      const result = TopicScore.create(baseProps());
      expect(result.isOk()).toBe(true);
      const ts = result.unwrap();
      expect(ts.topicName).toBe("System Design");
      expect(ts.score).toBe(4);
    });

    it("rejects empty topicName", () => {
      const result = TopicScore.create(baseProps({ topicName: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidReportInputError);
    });

    it("rejects whitespace-only topicName", () => {
      const result = TopicScore.create(baseProps({ topicName: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidReportInputError);
    });

    it("rejects score < 0", () => {
      const result = TopicScore.create(baseProps({ score: -0.1 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidReportInputError);
    });

    it("rejects score > 5", () => {
      const result = TopicScore.create(baseProps({ score: 5.1 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidReportInputError);
    });

    it("accepts score of exactly 0 (minimum boundary)", () => {
      const result = TopicScore.create(baseProps({ score: 0 }));
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().score).toBe(0);
    });

    it("accepts score of exactly 5 (maximum boundary)", () => {
      const result = TopicScore.create(baseProps({ score: 5 }));
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().score).toBe(5);
    });

    it("rejects empty justification", () => {
      const result = TopicScore.create(baseProps({ justification: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidReportInputError);
    });

    it("rejects whitespace-only justification", () => {
      const result = TopicScore.create(baseProps({ justification: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidReportInputError);
    });
  });

  describe("serialize() / fromSerialized()", () => {
    it("round-trips without data loss", () => {
      const props = baseProps();
      const result = TopicScore.create(props);
      expect(result.isOk()).toBe(true);
      const ts = result.unwrap();
      const serialized = ts.serialize();
      const restored = TopicScore.fromSerialized(serialized);
      expect(restored.topicName).toBe(props.topicName);
      expect(restored.score).toBe(props.score);
      expect(restored.justification).toBe(props.justification);
    });

    it("serialize() returns all TopicScoreProps fields", () => {
      const props = baseProps();
      const ts = TopicScore.fromSerialized(props);
      const serialized = ts.serialize();
      expect(serialized).toEqual(props);
    });
  });
});
