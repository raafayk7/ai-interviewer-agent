import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CandidateInfo, FileRef, Interview, JobDescription, Report, TopicScore } from "@repo/domain";
import { DrizzleInterviewRepository } from "./drizzle-interview.repository.js";
import { DrizzleReportRepository } from "./drizzle-report.repository.js";
import { RepositoryConflictError } from "./errors/repository-error.js";
import { closeTestDb, getTestDb, truncateAll, type TestDatabase } from "../persistence/__test-helpers__/test-db.js";
import { reports } from "../persistence/schema/reports.js";

// ─── Builder helpers ───────────────────────────────────────────────────────────

function buildInterview(): Interview {
  const jdResult = JobDescription.create({
    title: "Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Design APIs"],
    requirements: ["TypeScript"],
    rawText: "JD body",
  });
  expect(jdResult.isOk()).toBe(true);

  const ciResult = CandidateInfo.create({
    fullName: "John Smith",
    email: "john@example.com",
    headline: "Backend Engineer",
    yearsOfExperience: 4,
    skills: ["TypeScript"],
    education: ["BSc CS"],
    rawText: "CV body",
  });
  expect(ciResult.isOk()).toBe(true);

  const jdRefResult = FileRef.create({
    key: "reports/test/jd.pdf",
    contentType: "application/pdf",
    sizeBytes: 9999,
    originalFilename: "jd.pdf",
    uploadedAt: new Date("2026-01-01T00:00:00Z"),
  });
  expect(jdRefResult.isOk()).toBe(true);

  const cvRefResult = FileRef.create({
    key: "reports/test/cv.pdf",
    contentType: "application/pdf",
    sizeBytes: 8888,
    originalFilename: "cv.pdf",
    uploadedAt: new Date("2026-01-01T00:00:00Z"),
  });
  expect(cvRefResult.isOk()).toBe(true);

  return Interview.create({
    recruiterId: "recruiter-001",
    jobDescription: jdResult.unwrap(),
    candidateInfo: ciResult.unwrap(),
    clientInstructions: "Assess for culture fit",
    scheduledAt: new Date("2026-03-01T09:00:00Z"),
    jdFileRef: jdRefResult.unwrap(),
    cvFileRef: cvRefResult.unwrap(),
  });
}

function buildTopicScore(name: string, score: number): TopicScore {
  const result = TopicScore.create({
    topicName: name,
    score,
    justification: `Candidate demonstrated ${name} at level ${score}`,
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
}

function buildReport(interviewId: string): Report {
  const result = Report.create({
    interviewId,
    overallRecommendation: "advance",
    topicScores: [buildTopicScore("System Design", 4)],
    communicationAssessment: "Excellent communication skills throughout the interview",
    strengths: ["Strong architecture thinking", "Clear explanations"],
    concerns: ["Limited database optimization experience"],
    followUpQuestions: ["How would you scale this to 10M users?"],
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("[Integration] DrizzleReportRepository", () => {
  let db: TestDatabase;
  let interviewRepo: DrizzleInterviewRepository;
  let reportRepo: DrizzleReportRepository;

  beforeEach(async () => {
    db = await getTestDb();
    await truncateAll(db);
    // TestDatabase is structurally identical at runtime; cast resolves the
    // $client property gap that only exists in the type definition.
    interviewRepo = new DrizzleInterviewRepository(db as never);
    reportRepo = new DrizzleReportRepository(db as never);
  });

  afterAll(closeTestDb);

  it("save inserts a new report and findById returns it with deep equality on serialized shape", async () => {
    const interview = buildInterview();
    const saveInterviewResult = await interviewRepo.save(interview);
    expect(saveInterviewResult.isOk()).toBe(true);

    const report = buildReport(interview.id);
    const originalSerialized = report.serialize();

    const saveResult = await reportRepo.save(report);
    expect(saveResult.isOk()).toBe(true);

    const findResult = await reportRepo.findById(report.id);
    expect(findResult.isOk()).toBe(true);

    const option = findResult.unwrap();
    expect(option.isSome()).toBe(true);

    const found = option.unwrap().serialize();
    expect(found.id).toBe(originalSerialized.id);
    expect(found.interviewId).toBe(originalSerialized.interviewId);
    expect(found.overallRecommendation).toBe(originalSerialized.overallRecommendation);
    expect(found.communicationAssessment).toBe(originalSerialized.communicationAssessment);
    expect(found.strengths).toEqual(originalSerialized.strengths);
    expect(found.concerns).toEqual(originalSerialized.concerns);
    expect(found.followUpQuestions).toEqual(originalSerialized.followUpQuestions);
    expect(found.topicScores.length).toBe(1);
    expect(found.topicScores[0]!.topicName).toBe("System Design");
    expect(found.topicScores[0]!.score).toBe(4);
  });

  it("save upserts on conflicting id — updated scores are reflected after reload", async () => {
    const interview = buildInterview();
    await interviewRepo.save(interview);

    const report = buildReport(interview.id);
    const firstSave = await reportRepo.save(report);
    expect(firstSave.isOk()).toBe(true);

    // Build a modified report with the same id by creating via fromSerialized with updated scores
    const updatedSerialized = {
      ...report.serialize(),
      overallRecommendation: "hold" as const,
      topicScores: [{ topicName: "System Design", score: 2, justification: "Weak on distributed systems" }],
      communicationAssessment: "Good but could be more concise",
    };
    const updatedReport = Report.fromSerialized(updatedSerialized);

    const secondSave = await reportRepo.save(updatedReport);
    expect(secondSave.isOk()).toBe(true);

    // Verify only 1 row exists
    const rows = await db.select().from(reports);
    expect(rows.length).toBe(1);

    const findResult = await reportRepo.findById(report.id);
    expect(findResult.isOk()).toBe(true);
    const option = findResult.unwrap();
    expect(option.isSome()).toBe(true);

    const reloaded = option.unwrap().serialize();
    expect(reloaded.overallRecommendation).toBe("hold");
    expect(reloaded.topicScores[0]!.score).toBe(2);
  });

  it("findById returns Result.Ok(Option.None) for a missing id — not an error", async () => {
    const findResult = await reportRepo.findById("00000000-0000-4000-8000-000000000099");
    expect(findResult.isOk()).toBe(true);

    const option = findResult.unwrap();
    expect(option.isNone()).toBe(true);
  });

  it("findByInterviewId returns the linked report after saving interview and report", async () => {
    const interview = buildInterview();
    await interviewRepo.save(interview);

    const report = buildReport(interview.id);
    await reportRepo.save(report);

    const findResult = await reportRepo.findByInterviewId(interview.id);
    expect(findResult.isOk()).toBe(true);

    const option = findResult.unwrap();
    expect(option.isSome()).toBe(true);

    const found = option.unwrap();
    expect(found.id).toBe(report.id);
    expect(found.interviewId).toBe(interview.id);
  });

  it("findByInterviewId returns Result.Ok(Option.None) when no report is linked to the interview", async () => {
    const interview = buildInterview();
    await interviewRepo.save(interview);

    const findResult = await reportRepo.findByInterviewId(interview.id);
    expect(findResult.isOk()).toBe(true);

    const option = findResult.unwrap();
    expect(option.isNone()).toBe(true);
  });

  it("JSONB round-trip preserves topicScores array with 3 entries and deep field equality", async () => {
    const interview = buildInterview();
    await interviewRepo.save(interview);

    const score1 = buildTopicScore("System Design", 5);
    const score2 = buildTopicScore("Algorithms", 3);
    const score3 = buildTopicScore("Communication", 4);

    const reportResult = Report.create({
      interviewId: interview.id,
      overallRecommendation: "advance",
      topicScores: [score1, score2, score3],
      communicationAssessment: "Demonstrates strong ability to explain complex concepts clearly",
      strengths: ["Deep technical expertise", "Team player"],
      concerns: ["Could improve on time management"],
      followUpQuestions: ["What is your biggest professional failure?", "How do you handle disagreements?"],
    });
    expect(reportResult.isOk()).toBe(true);
    const report = reportResult.unwrap();
    const original = report.serialize();

    await reportRepo.save(report);

    const findResult = await reportRepo.findById(report.id);
    expect(findResult.isOk()).toBe(true);
    const option = findResult.unwrap();
    expect(option.isSome()).toBe(true);

    const reloaded = option.unwrap().serialize();
    expect(reloaded.topicScores.length).toBe(3);
    expect(reloaded.topicScores[0]!.topicName).toBe(original.topicScores[0]!.topicName);
    expect(reloaded.topicScores[0]!.score).toBe(5);
    expect(reloaded.topicScores[1]!.topicName).toBe("Algorithms");
    expect(reloaded.topicScores[1]!.score).toBe(3);
    expect(reloaded.topicScores[2]!.topicName).toBe("Communication");
    expect(reloaded.topicScores[2]!.score).toBe(4);
    expect(reloaded.topicScores[0]!.justification).toBe(original.topicScores[0]!.justification);
  });

  it("FK violation when interviewId is unknown translates to RepositoryConflictError", async () => {
    // No interview inserted — interviewId points to a non-existent row
    const nonExistentInterviewId = "00000000-dead-4000-8000-000000000000";

    const reportSerialized = {
      id: "00000000-beef-4000-8000-000000000001",
      interviewId: nonExistentInterviewId,
      overallRecommendation: "reject" as const,
      topicScores: [{ topicName: "Coding", score: 1, justification: "Did not complete any problem" }],
      communicationAssessment: "Very poor communication throughout",
      strengths: [] as string[],
      concerns: ["Cannot communicate technical ideas"],
      followUpQuestions: [] as string[],
      generatedAt: new Date("2026-03-01T12:00:00Z"),
      createdAt: new Date("2026-03-01T12:00:00Z"),
      updatedAt: new Date("2026-03-01T12:00:00Z"),
    };

    const conflictResult = await (async () => {
      const { Result } = await import("@carbonteq/fp");
      const { translatePgError } = await import("./errors/translate-pg-error.js");
      return Result.tryAsyncCatch(
        () =>
          db
            .insert(reports)
            .values({
              id: reportSerialized.id,
              interviewId: reportSerialized.interviewId,
              overallRecommendation: reportSerialized.overallRecommendation,
              topicScores: reportSerialized.topicScores,
              communicationAssessment: reportSerialized.communicationAssessment,
              strengths: reportSerialized.strengths,
              concerns: reportSerialized.concerns,
              followUpQuestions: reportSerialized.followUpQuestions,
              generatedAt: reportSerialized.generatedAt,
              createdAt: reportSerialized.createdAt,
              updatedAt: reportSerialized.updatedAt,
            })
            .returning(),
        translatePgError("test.fkViolation"),
      ).toPromise();
    })();

    expect(conflictResult.isErr()).toBe(true);
    expect(conflictResult.unwrapErr()).toBeInstanceOf(RepositoryConflictError);
  });
});
