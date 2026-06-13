import { describe, expect, it } from "vitest";
import { Interview } from "./interview.entity.js";
import type { InterviewSerialized } from "./interview.entity.js";
import {
  InvalidInterviewStateTransitionError,
  TranscriptNotStrictlyBetterError,
} from "./errors/interview.errors.js";
import { INTERVIEW_STATUS } from "./interview-status.js";
import { JobDescription } from "./value-objects/job-description.js";
import { CandidateInfo } from "./value-objects/candidate-info.js";
import { InterviewPlan } from "./value-objects/interview-plan.js";
import { PlannedTopic, TOPIC_PRIORITY } from "./value-objects/planned-topic.js";
import { TranscriptEntry, SPEAKER } from "./value-objects/transcript-entry.js";
import { AgentNote } from "./value-objects/agent-note.js";
import { AgentInternalScore } from "./value-objects/agent-internal-score.js";
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

const makeAgentNote = (): AgentNote => {
  const r = AgentNote.create({
    note: "Candidate gave a concise API design answer.",
    recordedAtTurn: 1,
    recordedAt: new Date("2025-01-01T10:01:00Z"),
  });
  expect(r.isOk()).toBe(true);
  return r.unwrap();
};

const makeAgentInternalScore = (): AgentInternalScore => {
  const r = AgentInternalScore.create({
    topicName: "Algorithms",
    score: 4,
    justification: "Solved the core problem and discussed complexity.",
    recordedAtTurn: 2,
    recordedAt: new Date("2025-01-01T10:02:00Z"),
  });
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

const makeInProgressInterview = (): Interview => {
  const scheduledResult = makeInterview().schedule(makeInterviewPlan());
  expect(scheduledResult.isOk()).toBe(true);
  const startedResult = scheduledResult.unwrap().start(new Date("2025-06-01T09:05:00Z"));
  expect(startedResult.isOk()).toBe(true);
  return startedResult.unwrap();
};

const makeCompletedInterview = (): Interview => {
  const completedResult = makeInProgressInterview().complete(new Date("2025-06-01T09:50:00Z"), []);
  expect(completedResult.isOk()).toBe(true);
  return completedResult.unwrap();
};

const makeCompletedInterviewWithTranscript = (transcript: ReadonlyArray<TranscriptEntry>): Interview => {
  const completedResult = makeInProgressInterview().complete(new Date("2025-06-01T09:50:00Z"), transcript);
  expect(completedResult.isOk()).toBe(true);
  return completedResult.unwrap();
};

const makeCancelledInterview = (): Interview => {
  const cancelledResult = makeInProgressInterview().cancel();
  expect(cancelledResult.isOk()).toBe(true);
  return cancelledResult.unwrap();
};

const makeEvaluatedInterview = (): Interview => {
  const evaluatedResult = makeCompletedInterview().markEvaluated("report-uuid-001");
  expect(evaluatedResult.isOk()).toBe(true);
  return evaluatedResult.unwrap();
};

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

    it("has empty notes and internal scores", () => {
      const interview = makeInterview();
      expect(interview.notes).toHaveLength(0);
      expect(interview.internalScores).toHaveLength(0);
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

  describe("recomplete()", () => {
    it("replaces the stored transcript only when incoming is strictly better", () => {
      const stored = [
        makeTranscriptEntry(SPEAKER.AGENT, "Tell me about yourself."),
        makeTranscriptEntry(SPEAKER.CANDIDATE, "I build backend services."),
      ];
      const completed = makeCompletedInterviewWithTranscript(stored);
      const incoming = [
        ...stored,
        makeTranscriptEntry(SPEAKER.AGENT, "What changed at your last role?"),
      ];
      const recompletedAt = new Date("2025-06-01T10:00:00Z");

      const result = completed.recomplete(recompletedAt, incoming);

      expect(result.isOk()).toBe(true);
      const recompleted = result.unwrap();
      expect(recompleted.status).toBe(INTERVIEW_STATUS.COMPLETED);
      expect(recompleted.serialize().completedAt).toEqual(recompletedAt);
      expect(recompleted.transcript).toEqual(incoming);
      expect(completed.transcript).toEqual(stored);
    });

    it("rejects incoming transcript with equal non-empty entry count", () => {
      const stored = [
        makeTranscriptEntry(SPEAKER.AGENT, "Tell me about yourself."),
        makeTranscriptEntry(SPEAKER.CANDIDATE, "I build backend services."),
      ];
      const completed = makeCompletedInterviewWithTranscript(stored);
      const incoming = [
        makeTranscriptEntry(SPEAKER.AGENT, "Different first question."),
        makeTranscriptEntry(SPEAKER.CANDIDATE, "Different answer."),
      ];

      const result = completed.recomplete(new Date("2025-06-01T10:00:00Z"), incoming);

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(TranscriptNotStrictlyBetterError);
    });

    it("moves an EVALUATED interview back to COMPLETED when a strictly better transcript arrives", () => {
      const evaluated = makeCompletedInterviewWithTranscript([
        makeTranscriptEntry(SPEAKER.AGENT, "Tell me about yourself."),
      ]).markEvaluated("report-uuid-001");
      expect(evaluated.isOk()).toBe(true);
      const incoming = [
        makeTranscriptEntry(SPEAKER.AGENT, "Tell me about yourself."),
        makeTranscriptEntry(SPEAKER.CANDIDATE, "I build backend services."),
      ];

      const result = evaluated.unwrap().recomplete(new Date("2025-06-01T10:00:00Z"), incoming);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().status).toBe(INTERVIEW_STATUS.COMPLETED);
      expect(result.unwrap().serialize().reportId).toBe("report-uuid-001");
    });
  });

  describe("appendTranscriptEntry()", () => {
    it("succeeds when IN_PROGRESS and returns a new instance with the entry appended", () => {
      const inProgress = makeInProgressInterview();
      const entry = makeTranscriptEntry(SPEAKER.AGENT, "Tell me about your recent backend work.");
      const result = inProgress.appendTranscriptEntry(entry);

      expect(result.isOk()).toBe(true);
      const updated = result.unwrap();
      expect(updated).not.toBe(inProgress);
      expect(updated.transcript).toHaveLength(1);
      expect(updated.transcript[0]).toBe(entry);
      expect(inProgress.transcript).toHaveLength(0);
    });

    it("rejects when status is CREATED", () => {
      const result = makeInterview().appendTranscriptEntry(
        makeTranscriptEntry(SPEAKER.AGENT, "Tell me about yourself."),
      );
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    });

    it("rejects when status is SCHEDULED", () => {
      const scheduledResult = makeInterview().schedule(makeInterviewPlan());
      expect(scheduledResult.isOk()).toBe(true);
      const result = scheduledResult.unwrap().appendTranscriptEntry(
        makeTranscriptEntry(SPEAKER.AGENT, "Tell me about yourself."),
      );
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    });

    it("rejects when status is COMPLETED", () => {
      const result = makeCompletedInterview().appendTranscriptEntry(
        makeTranscriptEntry(SPEAKER.AGENT, "Tell me about yourself."),
      );
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    });

    it("rejects when status is EVALUATED", () => {
      const result = makeEvaluatedInterview().appendTranscriptEntry(
        makeTranscriptEntry(SPEAKER.AGENT, "Tell me about yourself."),
      );
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    });

    it("rejects when status is CANCELLED", () => {
      const result = makeCancelledInterview().appendTranscriptEntry(
        makeTranscriptEntry(SPEAKER.AGENT, "Tell me about yourself."),
      );
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    });
  });

  describe("appendNote()", () => {
    it("succeeds when IN_PROGRESS and returns a new instance with the note appended", () => {
      const inProgress = makeInProgressInterview();
      const note = makeAgentNote();
      const result = inProgress.appendNote(note);

      expect(result.isOk()).toBe(true);
      const updated = result.unwrap();
      expect(updated).not.toBe(inProgress);
      expect(updated.notes).toHaveLength(1);
      expect(updated.notes[0]).toBe(note);
      expect(inProgress.notes).toHaveLength(0);
    });

    it("rejects when not IN_PROGRESS", () => {
      const note = makeAgentNote();
      const scheduleResult = makeInterview().schedule(makeInterviewPlan());
      expect(scheduleResult.isOk()).toBe(true);
      const interviews = [
        makeInterview(),
        scheduleResult.unwrap(),
        makeCompletedInterview(),
        makeEvaluatedInterview(),
        makeCancelledInterview(),
      ];

      for (const interview of interviews) {
        const result = interview.appendNote(note);
        expect(result.isErr()).toBe(true);
        expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
      }
    });
  });

  describe("appendInternalScore()", () => {
    it("succeeds when IN_PROGRESS and returns a new instance with the score appended", () => {
      const inProgress = makeInProgressInterview();
      const score = makeAgentInternalScore();
      const result = inProgress.appendInternalScore(score);

      expect(result.isOk()).toBe(true);
      const updated = result.unwrap();
      expect(updated).not.toBe(inProgress);
      expect(updated.internalScores).toHaveLength(1);
      expect(updated.internalScores[0]).toBe(score);
      expect(inProgress.internalScores).toHaveLength(0);
    });

    it("rejects when not IN_PROGRESS", () => {
      const score = makeAgentInternalScore();
      const scheduleResult = makeInterview().schedule(makeInterviewPlan());
      expect(scheduleResult.isOk()).toBe(true);
      const interviews = [
        makeInterview(),
        scheduleResult.unwrap(),
        makeCompletedInterview(),
        makeEvaluatedInterview(),
        makeCancelledInterview(),
      ];

      for (const interview of interviews) {
        const result = interview.appendInternalScore(score);
        expect(result.isErr()).toBe(true);
        expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
      }
    });
  });

  describe("append methods with complete()", () => {
    it("complete after appendTranscriptEntry preserves appended entries in the final transcript", () => {
      const inProgress = makeInProgressInterview();
      const agentEntry = makeTranscriptEntry(SPEAKER.AGENT, "Tell me about yourself.");
      const candidateEntry = makeTranscriptEntry(SPEAKER.CANDIDATE, "I build backend services.");
      const firstAppend = inProgress.appendTranscriptEntry(agentEntry);
      expect(firstAppend.isOk()).toBe(true);
      const secondAppend = firstAppend.unwrap().appendTranscriptEntry(candidateEntry);
      expect(secondAppend.isOk()).toBe(true);

      const withTranscript = secondAppend.unwrap();
      const completedResult = withTranscript.complete(
        new Date("2025-06-01T09:50:00Z"),
        withTranscript.transcript,
      );
      expect(completedResult.isOk()).toBe(true);
      expect(completedResult.unwrap().transcript).toEqual([agentEntry, candidateEntry]);
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

  describe("fail()", () => {
    it("succeeds from IN_PROGRESS, records the reason, and returns a new FAILED instance", () => {
      const inProgress = makeInProgressInterview();
      const result = inProgress.fail("ElevenLabs transcript could not be recovered");

      expect(result.isOk()).toBe(true);
      const failed = result.unwrap();
      expect(failed).not.toBe(inProgress);
      expect(failed.status).toBe(INTERVIEW_STATUS.FAILED);
      expect(failed.serialize().notes).toHaveLength(1);
      expect(failed.serialize().notes[0]?.note).toBe("[failed] ElevenLabs transcript could not be recovered");
      expect(inProgress.status).toBe(INTERVIEW_STATUS.IN_PROGRESS);
      expect(inProgress.serialize().notes).toEqual([]);
    });

    it("fails from COMPLETED state with InvalidInterviewStateTransitionError", () => {
      const result = makeCompletedInterview().fail("Too late to fail");

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

  describe("revertToCompleted()", () => {
    it("reverts EVALUATED to COMPLETED and clears reportId", () => {
      const evaluated = makeEvaluatedInterview();

      const result = evaluated.revertToCompleted();

      expect(result.isOk()).toBe(true);
      const reverted = result.unwrap();
      expect(reverted.status).toBe(INTERVIEW_STATUS.COMPLETED);
      expect(reverted.serialize().reportId).toBeNull();
      expect(evaluated.serialize().reportId).toBe("report-uuid-001");
    });

    it("fails from COMPLETED state with InvalidInterviewStateTransitionError", () => {
      const result = makeCompletedInterview().revertToCompleted();

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
      expect(serialized.elevenLabsSessionId).toBeNull();
      expect(serialized.notes).toEqual([]);
      expect(serialized.internalScores).toEqual([]);
    });
  });

  describe("bindElevenLabsSession()", () => {
    it("binds from SCHEDULED and returns a new instance", () => {
      const scheduledResult = makeInterview().schedule(makeInterviewPlan());
      expect(scheduledResult.isOk()).toBe(true);

      const result = scheduledResult.unwrap().bindElevenLabsSession("conv-001");

      expect(result.isOk()).toBe(true);
      const bound = result.unwrap();
      expect(bound.serialize().elevenLabsSessionId).toBe("conv-001");
      expect(scheduledResult.unwrap().serialize().elevenLabsSessionId).toBeNull();
    });

    it("allows idempotent re-bind to the same session id", () => {
      const scheduledResult = makeInterview().schedule(makeInterviewPlan());
      expect(scheduledResult.isOk()).toBe(true);
      const first = scheduledResult.unwrap().bindElevenLabsSession("conv-001");
      expect(first.isOk()).toBe(true);

      const second = first.unwrap().bindElevenLabsSession("conv-001");

      expect(second.isOk()).toBe(true);
      expect(second.unwrap()).toBe(first.unwrap());
    });

    it("binds while IN_PROGRESS", () => {
      const result = makeInProgressInterview().bindElevenLabsSession("conv-002");

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().serialize().elevenLabsSessionId).toBe("conv-002");
    });

    it("rejects from COMPLETED", () => {
      const result = makeCompletedInterview().bindElevenLabsSession("conv-003");

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
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
        notes: [
          {
            note: "Candidate asked a useful clarification.",
            recordedAtTurn: 1,
            recordedAt: new Date("2025-06-01T09:07:00Z"),
          },
        ],
        internalScores: [
          {
            topicName: "Algorithms",
            score: 4,
            justification: "Correct solution with time complexity discussion.",
            recordedAtTurn: 2,
            recordedAt: new Date("2025-06-01T09:08:00Z"),
          },
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
        elevenLabsSessionId: "conv-001",
        createdAt: now,
        updatedAt: now,
      };

      const interview = Interview.fromSerialized(data);
      const reserialized = interview.serialize();

      expect(reserialized.id).toBe(data.id);
      expect(reserialized.status).toBe(INTERVIEW_STATUS.EVALUATED);
      expect(reserialized.recruiterId).toBe(data.recruiterId);
      expect(reserialized.reportId).toBe("report-uuid-001");
      expect(reserialized.elevenLabsSessionId).toBe("conv-001");
      expect(reserialized.startedAt).toEqual(data.startedAt);
      expect(reserialized.completedAt).toEqual(data.completedAt);
      expect(reserialized.transcript).toHaveLength(2);
      expect(reserialized.notes).toEqual(data.notes);
      expect(reserialized.internalScores).toEqual(data.internalScores);
      expect(reserialized.interviewPlan).not.toBeNull();
    });

    it("round-trips notes and internal scores appended to an in-progress interview", () => {
      const note = makeAgentNote();
      const score = makeAgentInternalScore();
      const noteResult = makeInProgressInterview().appendNote(note);
      expect(noteResult.isOk()).toBe(true);
      const scoreResult = noteResult.unwrap().appendInternalScore(score);
      expect(scoreResult.isOk()).toBe(true);

      const restored = Interview.fromSerialized(scoreResult.unwrap().serialize());
      expect(restored.serialize().notes).toEqual([note.serialize()]);
      expect(restored.serialize().internalScores).toEqual([score.serialize()]);
    });

    it("round-trips a FAILED interview with its failure note", () => {
      const failedResult = makeInProgressInterview().fail("Provider failure");
      expect(failedResult.isOk()).toBe(true);
      const serialized = failedResult.unwrap().serialize();

      const restored = Interview.fromSerialized(serialized);

      expect(restored.serialize().status).toBe(INTERVIEW_STATUS.FAILED);
      expect(restored.serialize().notes).toEqual(serialized.notes);
    });
  });
});
