import { describe, expect, it } from "vitest";
import { Report, RECOMMENDATION } from "./report.entity.js";
import type { ReportSerialized } from "./report.entity.js";
import { InvalidReportInputError } from "./errors/report.errors.js";
import { TopicScore } from "./value-objects/topic-score.js";

const makeTopicScore = (topicName = "System Design", score = 4): TopicScore => {
  const result = TopicScore.create({
    topicName,
    score,
    justification: "Candidate demonstrated strong understanding.",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const baseCreateProps = () => ({
  interviewId: "interview-uuid-001",
  overallRecommendation: RECOMMENDATION.ADVANCE,
  topicScores: [makeTopicScore()],
  communicationAssessment: "Excellent communication skills throughout the interview.",
  strengths: ["Strong problem-solving", "Clear articulation"],
  concerns: ["Limited experience with microservices"],
  followUpQuestions: ["How would you handle service discovery at scale?"],
});

describe("Report", () => {
  describe("create()", () => {
    it("succeeds with at least one topicScore", () => {
      const result = Report.create(baseCreateProps());
      expect(result.isOk()).toBe(true);
      const report = result.unwrap();
      expect(report.topicScores).toHaveLength(1);
      expect(report.overallRecommendation).toBe(RECOMMENDATION.ADVANCE);
    });

    it("assigns a non-empty UUID as id", () => {
      const result = Report.create(baseCreateProps());
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().id).toBeTruthy();
    });

    it("rejects empty topicScores array", () => {
      const result = Report.create({ ...baseCreateProps(), topicScores: [] });
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidReportInputError);
    });

    it("rejects empty communicationAssessment", () => {
      const result = Report.create({ ...baseCreateProps(), communicationAssessment: "" });
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidReportInputError);
    });

    it("rejects whitespace-only communicationAssessment", () => {
      const result = Report.create({ ...baseCreateProps(), communicationAssessment: "   " });
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidReportInputError);
    });

    it("accepts HOLD recommendation", () => {
      const result = Report.create({ ...baseCreateProps(), overallRecommendation: RECOMMENDATION.HOLD });
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().overallRecommendation).toBe(RECOMMENDATION.HOLD);
    });

    it("accepts REJECT recommendation", () => {
      const result = Report.create({ ...baseCreateProps(), overallRecommendation: RECOMMENDATION.REJECT });
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().overallRecommendation).toBe(RECOMMENDATION.REJECT);
    });
  });

  describe("serialize() / fromSerialized()", () => {
    it("round-trips a full report without data loss", () => {
      const props = baseCreateProps();
      const result = Report.create(props);
      expect(result.isOk()).toBe(true);
      const report = result.unwrap();
      const serialized = report.serialize();
      const restored = Report.fromSerialized(serialized);

      expect(restored.id).toBe(report.id);
      expect(restored.interviewId).toBe(props.interviewId);
      expect(restored.overallRecommendation).toBe(props.overallRecommendation);
      expect(restored.communicationAssessment).toBe(props.communicationAssessment);
      expect(restored.topicScores).toHaveLength(1);
      expect(restored.topicScores[0]?.topicName).toBe("System Design");
      expect([...restored.strengths]).toEqual(props.strengths);
      expect([...restored.concerns]).toEqual(props.concerns);
      expect([...restored.followUpQuestions]).toEqual(props.followUpQuestions);
    });

    it("fromSerialized preserves all ReportSerialized fields", () => {
      const now = new Date("2025-06-01T12:00:00Z");
      const serialized: ReportSerialized = {
        id: "report-uuid-001",
        interviewId: "interview-uuid-001",
        overallRecommendation: RECOMMENDATION.ADVANCE,
        topicScores: [
          { topicName: "System Design", score: 4, justification: "Strong knowledge." },
          { topicName: "Algorithms", score: 3, justification: "Acceptable performance." },
        ],
        communicationAssessment: "Clear and concise communication.",
        strengths: ["Problem-solving"],
        concerns: [],
        followUpQuestions: ["What is your availability?"],
        generatedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      const restored = Report.fromSerialized(serialized);
      const reserialized = restored.serialize();

      expect(reserialized.id).toBe(serialized.id);
      expect(reserialized.interviewId).toBe(serialized.interviewId);
      expect(reserialized.topicScores).toHaveLength(2);
      expect(reserialized.topicScores[1]?.topicName).toBe("Algorithms");
      expect(reserialized.generatedAt).toEqual(now);
    });
  });
});
