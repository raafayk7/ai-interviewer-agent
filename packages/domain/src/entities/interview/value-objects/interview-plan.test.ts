import { describe, expect, it } from "vitest";
import { InterviewPlan } from "./interview-plan.js";
import { PlannedTopic, TOPIC_PRIORITY } from "./planned-topic.js";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";
import type { InterviewPlanProps, InterviewPlanSerialized } from "./interview-plan.js";

const makeTopic = (): PlannedTopic => {
  const result = PlannedTopic.create({
    name: "Algorithms",
    questions: ["Reverse a linked list"],
    timeAllocationMinutes: 10,
    priority: TOPIC_PRIORITY.MUST_COVER,
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const baseProps = (overrides: Partial<InterviewPlanProps> = {}): InterviewPlanProps => ({
  topics: [makeTopic()],
  targetDurationMinutes: 15,
  maxDurationMinutes: 25,
  mustAskQuestions: ["Tell me about yourself"],
  ...overrides,
});

describe("InterviewPlan", () => {
  describe("create()", () => {
    it("creates a plan with one topic", () => {
      const result = InterviewPlan.create(baseProps());
      expect(result.isOk()).toBe(true);
      const plan = result.unwrap();
      expect(plan.topics).toHaveLength(1);
      expect(plan.targetDurationMinutes).toBe(15);
      expect(plan.maxDurationMinutes).toBe(25);
    });

    it("rejects empty topics array", () => {
      const result = InterviewPlan.create(baseProps({ topics: [] }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects targetDurationMinutes <= 0 — zero", () => {
      const result = InterviewPlan.create(baseProps({ targetDurationMinutes: 0 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects targetDurationMinutes <= 0 — negative", () => {
      const result = InterviewPlan.create(baseProps({ targetDurationMinutes: -1 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects maxDurationMinutes < targetDurationMinutes", () => {
      const result = InterviewPlan.create(baseProps({ targetDurationMinutes: 30, maxDurationMinutes: 20 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("accepts maxDurationMinutes equal to targetDurationMinutes", () => {
      const result = InterviewPlan.create(baseProps({ targetDurationMinutes: 20, maxDurationMinutes: 20 }));
      expect(result.isOk()).toBe(true);
    });
  });

  describe("serialize() / fromSerialized()", () => {
    it("round-trips without data loss", () => {
      const props = baseProps();
      const result = InterviewPlan.create(props);
      expect(result.isOk()).toBe(true);
      const plan = result.unwrap();
      const serialized = plan.serialize();
      const restored = InterviewPlan.fromSerialized(serialized);
      expect(restored.targetDurationMinutes).toBe(props.targetDurationMinutes);
      expect(restored.maxDurationMinutes).toBe(props.maxDurationMinutes);
      expect(restored.topics).toHaveLength(props.topics.length);
      expect(restored.topics[0]?.name).toBe(props.topics[0]?.name);
      expect([...restored.mustAskQuestions]).toEqual(props.mustAskQuestions);
    });

    it("fromSerialized reconstructs topic questions correctly", () => {
      const serialized: InterviewPlanSerialized = {
        topics: [
          {
            name: "Algorithms",
            questions: ["Reverse a linked list", "Two-sum problem"],
            timeAllocationMinutes: 10,
            priority: TOPIC_PRIORITY.MUST_COVER,
          },
        ],
        targetDurationMinutes: 15,
        maxDurationMinutes: 25,
        mustAskQuestions: [],
      };
      const restored = InterviewPlan.fromSerialized(serialized);
      expect([...(restored.topics[0]?.questions ?? [])]).toEqual(["Reverse a linked list", "Two-sum problem"]);
    });
  });
});
