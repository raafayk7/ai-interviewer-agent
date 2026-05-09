import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CandidateInfo, FileRef, Interview, InterviewPlan, JobDescription, PlannedTopic, TranscriptEntry } from "@repo/domain";
import { DrizzleInterviewRepository } from "./drizzle-interview.repository.js";
import { RepositoryConflictError } from "./errors/repository-error.js";
import { closeTestDb, getTestDb, truncateAll, type TestDatabase } from "../persistence/__test-helpers__/test-db.js";
import { interviews } from "../persistence/schema/interviews.js";

// ─── Builder helpers ───────────────────────────────────────────────────────────

function buildJobDescription() {
  const result = JobDescription.create({
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Build APIs", "Design systems"],
    requirements: ["5y TypeScript", "DDD experience"],
    rawText: "Full JD body text here",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
}

function buildCandidateInfo(email = "jane@example.com") {
  const result = CandidateInfo.create({
    fullName: "Jane Doe",
    email,
    headline: "Senior Backend Engineer",
    yearsOfExperience: 6,
    skills: ["TypeScript", "Node.js", "PostgreSQL"],
    education: ["BSc Computer Science, MIT"],
    rawText: "Full CV body text here",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
}

function buildFileRef(key: string, filename: string) {
  const result = FileRef.create({
    key,
    contentType: "application/pdf",
    sizeBytes: 12345,
    originalFilename: filename,
    uploadedAt: new Date("2026-01-01T00:00:00Z"),
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
}

function buildInterview(recruiterId = "recruiter-001"): Interview {
  return Interview.create({
    recruiterId,
    jobDescription: buildJobDescription(),
    candidateInfo: buildCandidateInfo(),
    clientInstructions: "Focus on systems design and distributed systems",
    scheduledAt: new Date("2026-02-15T10:00:00Z"),
    jdFileRef: buildFileRef("interviews/test/jd.pdf", "jd.pdf"),
    cvFileRef: buildFileRef("interviews/test/cv.pdf", "cv.pdf"),
  });
}

function buildInterviewPlan(): InterviewPlan {
  const topicResult = PlannedTopic.create({
    name: "System Design",
    questions: ["Describe a distributed cache", "How would you design a rate limiter?"],
    timeAllocationMinutes: 20,
    priority: "must_cover",
  });
  expect(topicResult.isOk()).toBe(true);

  const planResult = InterviewPlan.create({
    topics: [topicResult.unwrap()],
    targetDurationMinutes: 30,
    maxDurationMinutes: 45,
    mustAskQuestions: ["Tell me about your biggest technical challenge"],
  });
  expect(planResult.isOk()).toBe(true);
  return planResult.unwrap();
}

function buildTranscriptEntries(): ReadonlyArray<TranscriptEntry> {
  const e1Result = TranscriptEntry.create({
    speaker: "agent",
    text: "Welcome! Let us start with systems design.",
    timestamp: new Date("2026-02-15T10:01:00Z"),
  });
  const e2Result = TranscriptEntry.create({
    speaker: "candidate",
    text: "Thank you. I would begin by clarifying requirements.",
    timestamp: new Date("2026-02-15T10:01:30Z"),
  });
  const e3Result = TranscriptEntry.create({
    speaker: "agent",
    text: "Great. Can you walk me through your proposed architecture?",
    timestamp: new Date("2026-02-15T10:02:00Z"),
  });
  expect(e1Result.isOk()).toBe(true);
  expect(e2Result.isOk()).toBe(true);
  expect(e3Result.isOk()).toBe(true);
  return [e1Result.unwrap(), e2Result.unwrap(), e3Result.unwrap()];
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("[Integration] DrizzleInterviewRepository", () => {
  let db: TestDatabase;
  let repo: DrizzleInterviewRepository;

  beforeEach(async () => {
    db = await getTestDb();
    await truncateAll(db);
    // The TestDatabase is structurally compatible with Database at runtime;
    // the $client property difference is a type-only concern.
    repo = new DrizzleInterviewRepository(db as never);
  });

  afterAll(closeTestDb);

  it("save inserts a new interview and findById returns it with matching serialized shape", async () => {
    const interview = buildInterview();
    const original = interview.serialize();

    const saveResult = await repo.save(interview);
    expect(saveResult.isOk()).toBe(true);

    const findResult = await repo.findById(interview.id);
    expect(findResult.isOk()).toBe(true);

    const option = findResult.unwrap();
    expect(option.isSome()).toBe(true);

    const found = option.unwrap();
    const serialized = found.serialize();

    expect(serialized.id).toBe(original.id);
    expect(serialized.recruiterId).toBe(original.recruiterId);
    expect(serialized.status).toBe(original.status);
    expect(serialized.clientInstructions).toBe(original.clientInstructions);
    expect(serialized.jobDescription.title).toBe(original.jobDescription.title);
    expect(serialized.jobDescription.company).toBe(original.jobDescription.company);
    expect(serialized.candidateInfo.fullName).toBe(original.candidateInfo.fullName);
    expect(serialized.candidateInfo.email).toBe(original.candidateInfo.email);
    expect(serialized.jdFileRef.key).toBe(original.jdFileRef.key);
    expect(serialized.cvFileRef.key).toBe(original.cvFileRef.key);
    expect(serialized.interviewPlan).toBeNull();
    expect(serialized.startedAt).toBeNull();
    expect(serialized.completedAt).toBeNull();
    expect(serialized.reportId).toBeNull();
  });

  it("save upserts on conflicting id — second save persists updated status and row count stays at 1", async () => {
    const interview = buildInterview();

    const firstSave = await repo.save(interview);
    expect(firstSave.isOk()).toBe(true);

    // Transition to SCHEDULED state
    const plan = buildInterviewPlan();
    const scheduleResult = interview.schedule(plan);
    expect(scheduleResult.isOk()).toBe(true);
    const scheduled = scheduleResult.unwrap();

    const secondSave = await repo.save(scheduled);
    expect(secondSave.isOk()).toBe(true);

    const rows = await db.select().from(interviews);
    expect(rows.length).toBe(1);

    const findResult = await repo.findById(interview.id);
    expect(findResult.isOk()).toBe(true);
    const option = findResult.unwrap();
    expect(option.isSome()).toBe(true);
    expect(option.unwrap().status).toBe("SCHEDULED");
  });

  it("findById returns Result.Ok(Option.None) for a missing id — not an error", async () => {
    const findResult = await repo.findById("00000000-0000-4000-8000-000000000000");
    expect(findResult.isOk()).toBe(true);

    const option = findResult.unwrap();
    expect(option.isNone()).toBe(true);
  });

  it("listByRecruiter returns only interviews belonging to the queried recruiter", async () => {
    const interviewA1 = buildInterview("recruiter-A");
    const interviewA2 = buildInterview("recruiter-A");
    const interviewB1 = buildInterview("recruiter-B");

    await repo.save(interviewA1);
    await repo.save(interviewA2);
    await repo.save(interviewB1);

    const listResult = await repo.listByRecruiter("recruiter-A");
    expect(listResult.isOk()).toBe(true);

    const list = listResult.unwrap();
    expect(list.length).toBe(2);

    const ids = list.map((i) => i.id);
    expect(ids).toContain(interviewA1.id);
    expect(ids).toContain(interviewA2.id);
    expect(ids).not.toContain(interviewB1.id);
  });

  it("listByRecruiter returns Result.Ok([]) for an unknown recruiter", async () => {
    const interview = buildInterview("recruiter-known");
    await repo.save(interview);

    const listResult = await repo.listByRecruiter("recruiter-unknown");
    expect(listResult.isOk()).toBe(true);
    expect(listResult.unwrap()).toHaveLength(0);
  });

  it("delete removes the row and subsequent findById returns None", async () => {
    const interview = buildInterview();

    const saveResult = await repo.save(interview);
    expect(saveResult.isOk()).toBe(true);

    const deleteResult = await repo.delete(interview.id);
    expect(deleteResult.isOk()).toBe(true);

    const findResult = await repo.findById(interview.id);
    expect(findResult.isOk()).toBe(true);
    expect(findResult.unwrap().isNone()).toBe(true);
  });

  it("JSONB round-trip preserves interviewPlan and transcript entries with deep equality", async () => {
    const interview = buildInterview();
    const plan = buildInterviewPlan();
    const entries = buildTranscriptEntries();

    // Schedule to attach the plan
    const scheduleResult = interview.schedule(plan);
    expect(scheduleResult.isOk()).toBe(true);
    const scheduled = scheduleResult.unwrap();

    // Start and complete to attach transcript
    const startResult = scheduled.start(new Date("2026-02-15T10:00:00Z"));
    expect(startResult.isOk()).toBe(true);
    const started = startResult.unwrap();

    const completeResult = started.complete(new Date("2026-02-15T10:45:00Z"), entries);
    expect(completeResult.isOk()).toBe(true);
    const completed = completeResult.unwrap();

    const saveResult = await repo.save(completed);
    expect(saveResult.isOk()).toBe(true);

    const findResult = await repo.findById(completed.id);
    expect(findResult.isOk()).toBe(true);
    const option = findResult.unwrap();
    expect(option.isSome()).toBe(true);

    const reloaded = option.unwrap().serialize();
    const original = completed.serialize();

    // Verify interviewPlan JSONB round-trip
    expect(reloaded.interviewPlan).not.toBeNull();
    expect(reloaded.interviewPlan!.targetDurationMinutes).toBe(original.interviewPlan!.targetDurationMinutes);
    expect(reloaded.interviewPlan!.maxDurationMinutes).toBe(original.interviewPlan!.maxDurationMinutes);
    expect(reloaded.interviewPlan!.topics.length).toBe(original.interviewPlan!.topics.length);
    expect(reloaded.interviewPlan!.topics[0]!.name).toBe(original.interviewPlan!.topics[0]!.name);
    expect(reloaded.interviewPlan!.mustAskQuestions).toEqual(original.interviewPlan!.mustAskQuestions);

    // Verify transcript JSONB round-trip
    expect(reloaded.transcript.length).toBe(3);
    expect(reloaded.transcript[0]!.speaker).toBe("agent");
    expect(reloaded.transcript[0]!.text).toBe(original.transcript[0]!.text);
    expect(reloaded.transcript[1]!.speaker).toBe("candidate");
    expect(reloaded.transcript[2]!.text).toBe(original.transcript[2]!.text);
  });

  it("pg unique-violation on a raw duplicate insert translates to RepositoryConflictError", async () => {
    const interview = buildInterview();
    const serialized = interview.serialize();

    // First insert via upsert-capable repo — establishes the row
    const firstSave = await repo.save(interview);
    expect(firstSave.isOk()).toBe(true);

    // Second raw insert bypasses the onConflictDoUpdate to trigger a 23505 unique violation
    const conflictResult = await (async () => {
      const { Result } = await import("@carbonteq/fp");
      const { translatePgError } = await import("./errors/translate-pg-error.js");
      return Result.tryAsyncCatch(
        () =>
          db
            .insert(interviews)
            .values({
              id: serialized.id,
              recruiterId: serialized.recruiterId,
              status: serialized.status,
              jobDescription: serialized.jobDescription,
              candidateInfo: serialized.candidateInfo,
              clientInstructions: serialized.clientInstructions,
              interviewPlan: serialized.interviewPlan,
              transcript: serialized.transcript,
              jdFileRef: serialized.jdFileRef,
              cvFileRef: serialized.cvFileRef,
              scheduledAt: serialized.scheduledAt,
              startedAt: serialized.startedAt,
              completedAt: serialized.completedAt,
              reportId: serialized.reportId,
              createdAt: serialized.createdAt,
              updatedAt: serialized.updatedAt,
            })
            .returning(),
        translatePgError("test.uniqueViolation"),
      ).toPromise();
    })();

    expect(conflictResult.isErr()).toBe(true);
    expect(conflictResult.unwrapErr()).toBeInstanceOf(RepositoryConflictError);
  });
});
