import { describe, expect, it } from "vitest";
import { Interview } from "./interview.entity.js";
import type { InterviewSerialized } from "./interview.entity.js";
import { InvalidInterviewStateTransitionError } from "./errors/interview.errors.js";
import { INTERVIEW_STATUS } from "./interview-status.js";
import { JobDescription } from "./value-objects/job-description.js";
import { CandidateInfo } from "./value-objects/candidate-info.js";
import { InterviewPlan } from "./value-objects/interview-plan.js";
import { PlannedTopic, TOPIC_PRIORITY } from "./value-objects/planned-topic.js";
import { TranscriptEntry, SPEAKER } from "./value-objects/transcript-entry.js";
import { FileRef } from "../../shared/value-objects/file-ref.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeJobDescription = (): JobDescription => {
  const r = JobDescription.create({
    title: "Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Build APIs"],
    requirements: ["TypeScript"],
    rawText: "We need a backend engineer.",
  });
  expect(r.isOk()).toBe(true);
  return r.unwrap();
};

const makeCandidateInfo = (): CandidateInfo => {
  const r = CandidateInfo.create({
    fullName: "Jane Doe",
    email: "jane@example.com",
    headline: "Senior Engineer",
    yearsOfExperience: 5,
    skills: ["TypeScript"],
    education: ["B.Sc. CS"],
    rawText: "Jane is an experienced engineer.",
  });
  expect(r.isOk()).toBe(true);
  return r.unwrap();
};

const makeFileRef = (key: string): FileRef => {
  const r = FileRef.create({
    key,
    contentType: "application/pdf",
    sizeBytes: 1024,
    originalFilename: "file.pdf",
    uploadedAt: new Date("2025-01-01T00:00:00Z"),
  });
  expect(r.isOk()).toBe(true);
  return r.unwrap();
};

const makeInterviewPlan = (): InterviewPlan => {
  const topicResult = PlannedTopic.create({
    name: "Algorithms",
    questions: ["Reverse a linked list"],
    timeAllocationMinutes: 10,
    priority: TOPIC_PRIORITY.MUST_COVER,
  });
  expect(topicResult.isOk()).toBe(true);
  const planResult = InterviewPlan.create({
    topics: [topicResult.unwrap()],
    targetDurationMinutes: 15,
    maxDurationMinutes: 25,
    mustAskQuestions: [],
  });
  expect(planResult.isOk()).toBe(true);
  return planResult.unwrap();
};

const makeTranscriptEntry = (speaker: "agent" | "candidate", text: string): TranscriptEntry => {
  const r = TranscriptEntry.create({ speaker, text, timestamp: new Date("2025-01-01T10:00:00Z") });
  expect(r.isOk()).toBe(true);
  return r.unwrap();
};

const makeInterview = (): Interview =>
  Interview.create({
    recruiterId: "recruiter-001",
    jobDescription: makeJobDescription(),
    candidateInfo: makeCandidateInfo(),
    clientInstructions: "Focus on system design.",
    scheduledAt: new Date("2025-06-01T09:00:00Z"),
    jdFileRef: makeFileRef("interviews/abc/jd.pdf"),
    cvFileRef: makeFileRef("interviews/abc/cv.pdf"),
  });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Interview", () => {
  describe("create()", () => {
    it("lands in CREATED status", () => {
      const interview = makeInterview();
      expect(interview.status).toBe(INTERVIEW_STATUS.CREATED);
    });

    it("has no interview plan (Option.None)", () => {
      const interview = makeInterview();
      const serialized = interview.serialize();
      expect(serialized.interviewPlan).toBeNull();
    });

    it("has an empty transcript", () => {
      const interview = makeInterview();
      expect(interview.transcript).toHaveLength(0);
    });

    it("has no startedAt (Option.None)", () => {
      const interview = makeInterview();
      const serialized = interview.serialize();
      expect(serialized.startedAt).toBeNull();
    });

    it("has no completedAt (Option.None)", () => {
      const interview = makeInterview();
      const serialized = interview.serialize();
      expect(serialized.completedAt).toBeNull();
    });

    it("has no reportId (Option.None)", () => {
      const interview = makeInterview();
      const serialized = interview.serialize();
      expect(serialized.reportId).toBeNull();
    });

    it("assigns a non-empty UUID as id", () => {
      const interview = makeInterview();
      expect(interview.id).toBeTruthy();
      expect(typeof interview.id).toBe("string");
    });
  });

  describe("schedule()", () => {
    it("succeeds from CREATED state and returns Ok", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      const result = interview.schedule(plan);
      expect(result.isOk()).toBe(true);
    });

    it("transitions status to SCHEDULED", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      const result = interview.schedule(plan);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().status).toBe(INTERVIEW_STATUS.SCHEDULED);
    });

    it("attaches the plan to the new instance", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      const result = interview.schedule(plan);
      expect(result.isOk()).toBe(true);
      const scheduled = result.unwrap();
      expect(scheduled.serialize().interviewPlan).not.toBeNull();
    });

    it("returns a new instance with the same id", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      const result = interview.schedule(plan);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().id).toBe(interview.id);
    });

    it("does not mutate the original instance — original stays CREATED", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      interview.schedule(plan);
      expect(interview.status).toBe(INTERVIEW_STATUS.CREATED);
    });

    it("does not mutate the original instance — original plan stays None", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      interview.schedule(plan);
      expect(interview.serialize().interviewPlan).toBeNull();
    });

    it("fails from SCHEDULED state with InvalidInterviewStateTransitionError", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      const scheduledResult = interview.schedule(plan);
      expect(scheduledResult.isOk()).toBe(true);
      const scheduled = scheduledResult.unwrap();
      const result = scheduled.schedule(plan);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    });
  });

  describe("start()", () => {
    it("succeeds from SCHEDULED state and sets startedAt", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      const scheduledResult = interview.schedule(plan);
      expect(scheduledResult.isOk()).toBe(true);
      const scheduled = scheduledResult.unwrap();
      const startTime = new Date("2025-06-01T09:05:00Z");
      const result = scheduled.start(startTime);
      expect(result.isOk()).toBe(true);
      const started = result.unwrap();
      expect(started.status).toBe(INTERVIEW_STATUS.IN_PROGRESS);
      expect(started.serialize().startedAt).toEqual(startTime);
    });

    it("fails from CREATED state with InvalidInterviewStateTransitionError", () => {
      const interview = makeInterview();
      const result = interview.start(new Date());
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    });
  });

  describe("complete()", () => {
    it("succeeds from IN_PROGRESS state and captures transcript and completedAt", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      const scheduledResult = interview.schedule(plan);
      expect(scheduledResult.isOk()).toBe(true);
      const startedResult = scheduledResult.unwrap().start(new Date("2025-06-01T09:05:00Z"));
      expect(startedResult.isOk()).toBe(true);
      const inProgress = startedResult.unwrap();

      const transcript = [
        makeTranscriptEntry(SPEAKER.AGENT, "Tell me about yourself."),
        makeTranscriptEntry(SPEAKER.CANDIDATE, "I am an experienced engineer."),
      ];
      const completedAt = new Date("2025-06-01T09:50:00Z");
      const result = inProgress.complete(completedAt, transcript);

      expect(result.isOk()).toBe(true);
      const completed = result.unwrap();
      expect(completed.status).toBe(INTERVIEW_STATUS.COMPLETED);
      expect(completed.serialize().completedAt).toEqual(completedAt);
      expect(completed.transcript).toHaveLength(2);
    });

    it("fails from CREATED state with InvalidInterviewStateTransitionError", () => {
      const interview = makeInterview();
      const result = interview.complete(new Date(), []);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    });
  });

  describe("cancel()", () => {
    it("succeeds from IN_PROGRESS state", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      const scheduledResult = interview.schedule(plan);
      expect(scheduledResult.isOk()).toBe(true);
      const startedResult = scheduledResult.unwrap().start(new Date());
      expect(startedResult.isOk()).toBe(true);
      const inProgress = startedResult.unwrap();

      const result = inProgress.cancel();
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().status).toBe(INTERVIEW_STATUS.CANCELLED);
    });

    it("fails from CREATED state with InvalidInterviewStateTransitionError", () => {
      const interview = makeInterview();
      const result = interview.cancel();
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    });
  });

  describe("markEvaluated()", () => {
    it("succeeds from COMPLETED state and attaches reportId", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      const scheduledResult = interview.schedule(plan);
      expect(scheduledResult.isOk()).toBe(true);
      const startedResult = scheduledResult.unwrap().start(new Date());
      expect(startedResult.isOk()).toBe(true);
      const completedResult = startedResult.unwrap().complete(new Date(), []);
      expect(completedResult.isOk()).toBe(true);
      const completed = completedResult.unwrap();

      const reportId = "report-uuid-001";
      const result = completed.markEvaluated(reportId);
      expect(result.isOk()).toBe(true);
      const evaluated = result.unwrap();
      expect(evaluated.status).toBe(INTERVIEW_STATUS.EVALUATED);
      expect(evaluated.serialize().reportId).toBe(reportId);
    });

    it("fails from EVALUATED state (terminal) with InvalidInterviewStateTransitionError", () => {
      const interview = makeInterview();
      const plan = makeInterviewPlan();
      const scheduledResult = interview.schedule(plan);
      expect(scheduledResult.isOk()).toBe(true);
      const startedResult = scheduledResult.unwrap().start(new Date());
      expect(startedResult.isOk()).toBe(true);
      const completedResult = startedResult.unwrap().complete(new Date(), []);
      expect(completedResult.isOk()).toBe(true);
      const evaluatedResult = completedResult.unwrap().markEvaluated("report-uuid-001");
      expect(evaluatedResult.isOk()).toBe(true);
      const evaluated = evaluatedResult.unwrap();

      const result = evaluated.markEvaluated("another-report");
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    });
  });

  describe("serialize()", () => {
    it("emits null for absent Option fields on a fresh CREATED interview", () => {
      const interview = makeInterview();
      const serialized = interview.serialize();
      expect(serialized.interviewPlan).toBeNull();
      expect(serialized.startedAt).toBeNull();
      expect(serialized.completedAt).toBeNull();
      expect(serialized.reportId).toBeNull();
    });
  });

  describe("fromSerialized()", () => {
    it("round-trips a fully-populated EVALUATED interview", () => {
      const now = new Date("2025-06-01T09:00:00Z");
      const data: InterviewSerialized = {
        id: "11111111-1111-4111-8111-111111111111",
        recruiterId: "recruiter-001",
        status: INTERVIEW_STATUS.EVALUATED,
        jobDescription: {
          title: "Backend Engineer",
          company: "Acme Corp",
          responsibilities: ["Build APIs"],
          requirements: ["TypeScript"],
          rawText: "We need a backend engineer.",
        },
        candidateInfo: {
          fullName: "Jane Doe",
          email: "jane@example.com",
          headline: "Senior Engineer",
          yearsOfExperience: 5,
          skills: ["TypeScript"],
          education: ["B.Sc. CS"],
          rawText: "Jane is an experienced engineer.",
        },
        clientInstructions: "Focus on system design.",
        interviewPlan: {
          topics: [
            {
              name: "Algorithms",
              questions: ["Reverse a linked list"],
              timeAllocationMinutes: 10,
              priority: TOPIC_PRIORITY.MUST_COVER,
            },
          ],
          targetDurationMinutes: 15,
          maxDurationMinutes: 25,
          mustAskQuestions: [],
        },
        transcript: [
          { speaker: SPEAKER.AGENT, text: "Tell me about yourself.", timestamp: new Date("2025-06-01T09:05:00Z") },
          { speaker: SPEAKER.CANDIDATE, text: "I am experienced.", timestamp: new Date("2025-06-01T09:06:00Z") },
        ],
        jdFileRef: {
          key: "interviews/abc/jd.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
          originalFilename: "jd.pdf",
          uploadedAt: now,
        },
        cvFileRef: {
          key: "interviews/abc/cv.pdf",
          contentType: "application/pdf",
          sizeBytes: 2048,
          originalFilename: "cv.pdf",
          uploadedAt: now,
        },
        scheduledAt: new Date("2025-06-01T09:00:00Z"),
        startedAt: new Date("2025-06-01T09:05:00Z"),
        completedAt: new Date("2025-06-01T09:50:00Z"),
        reportId: "report-uuid-001",
        createdAt: now,
        updatedAt: now,
      };

      const interview = Interview.fromSerialized(data);
      const reserialized = interview.serialize();

      expect(reserialized.id).toBe(data.id);
      expect(reserialized.status).toBe(INTERVIEW_STATUS.EVALUATED);
      expect(reserialized.recruiterId).toBe(data.recruiterId);
      expect(reserialized.reportId).toBe("report-uuid-001");
      expect(reserialized.startedAt).toEqual(data.startedAt);
      expect(reserialized.completedAt).toEqual(data.completedAt);
      expect(reserialized.transcript).toHaveLength(2);
      expect(reserialized.interviewPlan).not.toBeNull();
    });
  });
});
