import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CandidateInfo,
  FileRef,
  INTERVIEW_STATUS,
  Interview,
  JobDescription,
  Report,
  SPEAKER,
  TopicScore,
  TranscriptEntry,
} from "@repo/domain";
import { DrizzleInterviewReportInvalidationService } from "./drizzle-interview-report-invalidation.service.js";
import { interviews } from "./schema/interviews.js";
import { reports } from "./schema/reports.js";
import {
  closeTestDb,
  getTestDb,
  truncateAll,
  type TestDatabase,
} from "./__test-helpers__/test-db.js";
import { DrizzleInterviewRepository } from "../repositories/drizzle-interview.repository.js";
import { DrizzleReportRepository } from "../repositories/drizzle-report.repository.js";

// ─── Builder helpers ───────────────────────────────────────────────────────────

function buildInterview(): Interview {
  const jd = JobDescription.create({
    title: "Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Design APIs"],
    requirements: ["TypeScript"],
    rawText: "JD body",
  }).unwrap();

  const ci = CandidateInfo.create({
    fullName: "John Smith",
    email: "john@example.com",
    headline: "Backend Engineer",
    yearsOfExperience: 4,
    skills: ["TypeScript"],
    education: ["BSc CS"],
    rawText: "CV body",
  }).unwrap();

  const jdRef = FileRef.create({
    key: "reports/test/jd.pdf",
    contentType: "application/pdf",
    sizeBytes: 9999,
    originalFilename: "jd.pdf",
    uploadedAt: new Date("2026-01-01T00:00:00Z"),
  }).unwrap();

  const cvRef = FileRef.create({
    key: "reports/test/cv.pdf",
    contentType: "application/pdf",
    sizeBytes: 8888,
    originalFilename: "cv.pdf",
    uploadedAt: new Date("2026-01-01T00:00:00Z"),
  }).unwrap();

  return Interview.create({
    recruiterId: "recruiter-001",
    jobDescription: jd,
    candidateInfo: ci,
    clientInstructions: "Assess for culture fit",
    scheduledAt: new Date("2026-03-01T09:00:00Z"),
    jdFileRef: jdRef,
    cvFileRef: cvRef,
  });
}

function buildReport(interviewId: string): Report {
  const topicScore = TopicScore.create({
    topicName: "System Design",
    score: 4,
    justification: "Candidate demonstrated System Design at level 4",
  }).unwrap();

  return Report.create({
    interviewId,
    overallRecommendation: "advance",
    topicScores: [topicScore],
    communicationAssessment: "Excellent communication skills throughout the interview",
    strengths: ["Strong architecture thinking"],
    concerns: ["Limited database optimization experience"],
    followUpQuestions: ["How would you scale this to 10M users?"],
  }).unwrap();
}

function buildEntries(texts: ReadonlyArray<string>): TranscriptEntry[] {
  return texts.map((text, i) =>
    TranscriptEntry.create({
      speaker: i % 2 === 0 ? SPEAKER.AGENT : SPEAKER.CANDIDATE,
      text,
      timestamp: new Date(Date.parse("2026-03-01T09:10:00Z") + i * 1000),
    }).unwrap(),
  );
}

/**
 * Wraps the test database so that, inside a `transaction(...)`, the interview
 * upsert runs against the real transaction but the subsequent `tx.delete(...)`
 * throws. This injects a failure BETWEEN the two writes the service performs,
 * forcing Postgres to roll the (already-applied) interview upsert back — the
 * exact partial-execution rollback ADR-035 Mechanism 3 requires to be tested.
 */
function makeDbWithThrowingDelete(realDb: TestDatabase): TestDatabase {
  const bindThrough = (target: object, prop: string | symbol, receiver: unknown): unknown => {
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  };

  return new Proxy(realDb, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return (cb: (tx: unknown) => Promise<unknown>) =>
          target.transaction((realTx) =>
            cb(
              new Proxy(realTx as object, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === "delete") {
                    return () => {
                      throw new Error("injected delete failure");
                    };
                  }
                  return bindThrough(txTarget, txProp, txReceiver);
                },
              }),
            ),
          );
      }
      return bindThrough(target, prop, receiver);
    },
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("[Integration] DrizzleInterviewReportInvalidationService", () => {
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

  /**
   * Seeds an EVALUATED interview (2-entry transcript, linked report) plus its
   * report row, and returns the COMPLETED+reportId-null interview carrying a
   * strictly-better 3-entry transcript — i.e. exactly what the use case hands
   * to `invalidateStaleReport` after revert+recomplete.
   */
  async function seedEvaluatedWithBetterTranscript(): Promise<{
    interviewId: string;
    reportId: string;
    invalidated: Interview;
  }> {
    const base = buildInterview();
    const report = buildReport(base.id);
    const storedEntries = buildEntries(["Question one?", "Answer one."]); // 2 non-empty

    const evaluated = Interview.fromSerialized({
      ...base.serialize(),
      status: INTERVIEW_STATUS.EVALUATED,
      reportId: report.id,
      startedAt: new Date("2026-03-01T09:05:00Z"),
      completedAt: new Date("2026-03-01T09:30:00Z"),
      transcript: storedEntries.map((e) => e.serialize()),
    });

    // Interview must exist before the report (reports.interview_id FK).
    expect((await interviewRepo.save(evaluated)).isOk()).toBe(true);
    expect((await reportRepo.save(report)).isOk()).toBe(true);

    const reverted = evaluated.revertToCompleted().unwrap();
    const betterEntries = buildEntries(["Question one?", "Answer one.", "Question two?"]); // 3 > 2
    const invalidated = reverted.recomplete(new Date("2026-03-01T09:31:00Z"), betterEntries).unwrap();

    return { interviewId: base.id, reportId: report.id, invalidated };
  }

  it("commits both writes: interview becomes COMPLETED with reportId cleared AND the stale report is deleted", async () => {
    const { interviewId, invalidated } = await seedEvaluatedWithBetterTranscript();

    const service = new DrizzleInterviewReportInvalidationService(db as never);
    const result = await service.invalidateStaleReport(invalidated);
    expect(result.isOk()).toBe(true);

    const interviewRows = await db.select().from(interviews).where(eq(interviews.id, interviewId));
    expect(interviewRows).toHaveLength(1);
    expect(interviewRows[0]!.status).toBe(INTERVIEW_STATUS.COMPLETED);
    expect(interviewRows[0]!.reportId).toBeNull();
    expect(interviewRows[0]!.transcript).toHaveLength(3);

    const reportRows = await db.select().from(reports);
    expect(reportRows).toHaveLength(0);
  });

  it("rolls back atomically: a failure after the interview upsert leaves NEITHER write committed", async () => {
    const { interviewId, reportId, invalidated } = await seedEvaluatedWithBetterTranscript();

    const failingDb = makeDbWithThrowingDelete(db);
    const service = new DrizzleInterviewReportInvalidationService(failingDb as never);
    const result = await service.invalidateStaleReport(invalidated);
    expect(result.isErr()).toBe(true);

    // The interview upsert ran inside the transaction but must be rolled back:
    // the row retains its pre-call EVALUATED state, reportId, and 2-entry transcript.
    const interviewRows = await db.select().from(interviews).where(eq(interviews.id, interviewId));
    expect(interviewRows).toHaveLength(1);
    expect(interviewRows[0]!.status).toBe(INTERVIEW_STATUS.EVALUATED);
    expect(interviewRows[0]!.reportId).toBe(reportId);
    expect(interviewRows[0]!.transcript).toHaveLength(2);

    // The report delete never committed: the row still exists.
    const reportRows = await db.select().from(reports);
    expect(reportRows).toHaveLength(1);
    expect(reportRows[0]!.id).toBe(reportId);
  });
});
