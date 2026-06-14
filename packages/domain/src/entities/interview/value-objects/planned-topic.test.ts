import { describe, expect, it } from "vitest";
import { PlannedTopic, TOPIC_PRIORITY } from "./planned-topic.js";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";
import type { PlannedTopicProps } from "./planned-topic.js";

const baseProps = (overrides: Partial<PlannedTopicProps> = {}): PlannedTopicProps => ({
  name: "System Design",
  questions: ["How would you design a URL shortener?", "Discuss trade-offs of your approach."],
  timeAllocationMinutes: 15,
  priority: TOPIC_PRIORITY.MUST_COVER,
  ...overrides,
});

describe("PlannedTopic", () => {
  describe("create()", () => {
    it("creates a valid PlannedTopic from complete valid props", () => {
      const result = PlannedTopic.create(baseProps());
      expect(result.isOk()).toBe(true);
      const topic = result.unwrap();
      expect(topic.name).toBe("System Design");
      expect(topic.timeAllocationMinutes).toBe(15);
    });

    it("rejects empty name", () => {
      const result = PlannedTopic.create(baseProps({ name: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects whitespace-only name", () => {
      const result = PlannedTopic.create(baseProps({ name: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects empty questions array", () => {
      const result = PlannedTopic.create(baseProps({ questions: [] }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects timeAllocationMinutes <= 0 — zero", () => {
      const result = PlannedTopic.create(baseProps({ timeAllocationMinutes: 0 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects timeAllocationMinutes <= 0 — negative", () => {
      const result = PlannedTopic.create(baseProps({ timeAllocationMinutes: -5 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("accepts IF_TIME_PERMITS priority", () => {
      const result = PlannedTopic.create(baseProps({ priority: TOPIC_PRIORITY.IF_TIME_PERMITS }));
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().priority).toBe(TOPIC_PRIORITY.IF_TIME_PERMITS);
    });
  });

  describe("serialize() / fromSerialized()", () => {
    it("round-trips without data loss", () => {
      const props = baseProps();
      const result = PlannedTopic.create(props);
      expect(result.isOk()).toBe(true);
      const topic = result.unwrap();
      const serialized = topic.serialize();
      const restored = PlannedTopic.fromSerialized(serialized);
      expect(restored.name).toBe(props.name);
      expect([...restored.questions]).toEqual(props.questions);
      expect(restored.timeAllocationMinutes).toBe(props.timeAllocationMinutes);
      expect(restored.priority).toBe(props.priority);
    });
  });
});
