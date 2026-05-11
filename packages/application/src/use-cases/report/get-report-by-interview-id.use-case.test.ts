import { Option, Result } from "@carbonteq/fp";
import {
  RECOMMENDATION,
  Report,
  TopicScore,
  type IReportRepository,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import { GetReportByInterviewIdUseCase } from "./get-report-by-interview-id.use-case.js";

const makeTopicScore = (): TopicScore => {
  const result = TopicScore.create({
    topicName: "Backend Reliability",
    score: 4,
    justification: "Strong reliability examples.",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeReport = (): Report => {
  const result = Report.create({
    interviewId: "interview-001",
    overallRecommendation: RECOMMENDATION.ADVANCE,
    topicScores: [makeTopicScore()],
    communicationAssessment: "Clear and structured.",
    strengths: ["Strong examples"],
    concerns: [],
    followUpQuestions: ["How would you scale this system?"],
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeRepo = (overrides: Partial<IReportRepository> = {}): IReportRepository => ({
  save: vi.fn(),
  findById: vi.fn(),
  findByInterviewId: vi.fn(),
  ...overrides,
});

describe("GetReportByInterviewIdUseCase", () => {
  it("returns Some serialized report when found", async () => {
    const report = makeReport();
    const repo = makeRepo({
      findByInterviewId: vi.fn().mockResolvedValue(Result.Ok(Option.Some(report))),
    });

    const result = await new GetReportByInterviewIdUseCase(repo).execute({
      interviewId: report.interviewId,
    });

    expect(result.isOk()).toBe(true);
    const output = result.unwrap();
    expect(output.report.isSome()).toBe(true);
    expect(output.report.unwrap()).toEqual(report.serialize());
  });

  it("returns None when no report exists", async () => {
    const repo = makeRepo({
      findByInterviewId: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
    });

    const result = await new GetReportByInterviewIdUseCase(repo).execute({
      interviewId: "interview-001",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().report.isNone()).toBe(true);
  });

  it("maps repository errors to ServiceUnknownError", async () => {
    const repo = makeRepo({
      findByInterviewId: vi.fn().mockResolvedValue(Result.Err(new Error("read failed"))),
    });

    const result = await new GetReportByInterviewIdUseCase(repo).execute({
      interviewId: "interview-001",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe(
      "ReportRepository.findByInterviewId",
    );
  });
});
