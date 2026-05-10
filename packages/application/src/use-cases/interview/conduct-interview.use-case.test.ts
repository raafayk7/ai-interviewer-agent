import { Option, Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  INTERVIEW_STATUS,
  Interview,
  InterviewNotFoundError,
  InterviewPlan,
  InvalidInterviewInputError,
  InvalidInterviewStateTransitionError,
  JobDescription,
  PlannedTopic,
  TOPIC_PRIORITY,
  type IInterviewRepository,
} from "@repo/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import {
  AgentUnavailableError,
  END_INTERVIEW_REASON,
  type AgentTurnOutput,
  type IInterviewAgentService,
} from "../../ports/interview-agent/index.js";
import {
  SttUnavailableError,
  type ISpeechToTextService,
  type TranscriptChunk,
} from "../../ports/speech-to-text/index.js";
import {
  TtsUnavailableError,
  type ITextToSpeechService,
} from "../../ports/text-to-speech/index.js";
import { ConductInterviewUseCase } from "./conduct-interview.use-case.js";

const now = new Date("2026-05-10T10:00:00Z");

async function* audioChunks(): AsyncIterable<Uint8Array> {
  yield Uint8Array.from([1]);
}

async function* transcriptChunks(text: string): AsyncIterable<TranscriptChunk> {
  yield { text, isFinal: true, receivedAt: now };
}

const makeJobDescription = (): JobDescription => {
  const result = JobDescription.create({
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Build APIs"],
    requirements: ["TypeScript"],
    rawText: "We need a backend engineer.",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeCandidateInfo = (): CandidateInfo => {
  const result = CandidateInfo.create({
    fullName: "Jane Doe",
    email: "jane.doe@example.com",
    headline: "Senior Engineer",
    yearsOfExperience: 6,
    skills: ["TypeScript"],
    education: ["B.Sc. CS"],
    rawText: "Jane is an experienced engineer.",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeFileRef = (key: string): FileRef => {
  const result = FileRef.create({
    key,
    contentType: "application/pdf",
    sizeBytes: 1024,
    originalFilename: key.endsWith("jd.pdf") ? "jd.pdf" : "cv.pdf",
    uploadedAt: now,
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makePlan = (
  overrides: Partial<{
    targetDurationMinutes: number;
    maxDurationMinutes: number;
  }> = {},
): InterviewPlan => {
  const topic = PlannedTopic.create({
    name: "Backend Architecture",
    questions: ["How would you design a queue worker?"],
    timeAllocationMinutes: 10,
    priority: TOPIC_PRIORITY.MUST_COVER,
  });
  expect(topic.isOk()).toBe(true);

  const plan = InterviewPlan.create({
    topics: [topic.unwrap()],
    targetDurationMinutes: overrides.targetDurationMinutes ?? 15,
    maxDurationMinutes: overrides.maxDurationMinutes ?? 25,
    mustAskQuestions: ["Describe a production incident."],
  });
  expect(plan.isOk()).toBe(true);
  return plan.unwrap();
};

const makeCreatedInterview = (): Interview =>
  Interview.create({
    recruiterId: "recruiter-001",
    jobDescription: makeJobDescription(),
    candidateInfo: makeCandidateInfo(),
    clientInstructions: "Focus on system design.",
    scheduledAt: now,
    jdFileRef: makeFileRef("interviews/abc/jd.pdf"),
    cvFileRef: makeFileRef("interviews/abc/cv.pdf"),
  });

const makeScheduledInterview = (plan = makePlan()): Interview => {
  const scheduled = makeCreatedInterview().schedule(plan);
  expect(scheduled.isOk()).toBe(true);
  return scheduled.unwrap();
};

const makeRepo = (
  interview: Interview | null,
  overrides: Partial<IInterviewRepository> = {},
): IInterviewRepository => ({
  findById: vi.fn().mockResolvedValue(Result.Ok(interview === null ? Option.None : Option.Some(interview))),
  save: vi.fn().mockImplementation(async (next: Interview) => Result.Ok(next)),
  listByRecruiter: vi.fn(),
  delete: vi.fn(),
  ...overrides,
});

const makeAgent = (
  turns: ReadonlyArray<AgentTurnOutput>,
  onRun?: () => void,
): IInterviewAgentService => {
  let index = 0;
  return {
    runTurn: vi.fn().mockImplementation(async () => {
      onRun?.();
      const turn = turns[index] ?? turns[turns.length - 1];
      index += 1;
      return Result.Ok(turn);
    }),
  };
};

const makeStt = (
  transcribe = vi.fn().mockImplementation((_audio: AsyncIterable<Uint8Array>, ctx) =>
    Promise.resolve(Result.Ok(transcriptChunks(`answer ${ctx.turnIndex}`))),
  ),
): ISpeechToTextService => ({ transcribe });

const makeTts = (
  synthesize = vi.fn().mockResolvedValue(Result.Ok(audioChunks())),
): ITextToSpeechService => ({ synthesize });

const makeInput = (abortSignal = new AbortController().signal) => ({
  interviewId: "interview-001",
  candidateAudioIn: audioChunks(),
  agentAudioOut: vi.fn().mockResolvedValue(undefined),
  abortSignal,
});

const askTurn = (text: string, toolEvents: AgentTurnOutput["toolEvents"] = []): AgentTurnOutput => ({
  text,
  toolEvents,
  stopReason: "stop",
});

describe("ConductInterviewUseCase", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns InterviewNotFoundError when the interview is missing", async () => {
    const repo = makeRepo(null);
    const useCase = new ConductInterviewUseCase({
      interviews: repo,
      agent: makeAgent([askTurn("hello")]),
      stt: makeStt(),
      tts: makeTts(),
      clock: () => now,
    });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("returns InvalidInterviewInputError when the plan is absent", async () => {
    const repo = makeRepo(makeCreatedInterview());
    const useCase = new ConductInterviewUseCase({
      interviews: repo,
      agent: makeAgent([askTurn("hello")]),
      stt: makeStt(),
      tts: makeTts(),
      clock: () => now,
    });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("maps repository lookup errors to ServiceUnknownError", async () => {
    const repo = makeRepo(null, {
      findById: vi.fn().mockResolvedValue(Result.Err(new Error("database unavailable"))),
    });
    const useCase = new ConductInterviewUseCase({
      interviews: repo,
      agent: makeAgent([askTurn("hello")]),
      stt: makeStt(),
      tts: makeTts(),
      clock: () => now,
    });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe("InterviewRepository.findById");
  });

  it("returns a state transition error when the interview is not SCHEDULED", async () => {
    const startResult = makeScheduledInterview().start(now);
    expect(startResult.isOk()).toBe(true);
    const completeResult = startResult.unwrap().complete(now, []);
    expect(completeResult.isOk()).toBe(true);
    const completed = completeResult.unwrap();
    const repo = makeRepo(completed);
    const useCase = new ConductInterviewUseCase({
      interviews: repo,
      agent: makeAgent([askTurn("hello")]),
      stt: makeStt(),
      tts: makeTts(),
      clock: () => now,
    });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("runs a multi-turn interview, records notes and scores, then completes", async () => {
    const repo = makeRepo(makeScheduledInterview());
    const agent = makeAgent([
      askTurn("Question 1", [
        { kind: "take_note", note: "Strong communication." },
        { kind: "next_question", topicName: "Backend Architecture", question: "Question 1" },
      ]),
      askTurn("Question 2", [
        {
          kind: "score_answer",
          topicName: "Backend Architecture",
          score: 4,
          justification: "Good systems instincts.",
        },
      ]),
      askTurn("Thanks, we are done.", [
        { kind: "end_interview", reason: END_INTERVIEW_REASON.ALL_TOPICS_COVERED },
      ]),
    ]);
    const useCase = new ConductInterviewUseCase({
      interviews: repo,
      agent,
      stt: makeStt(),
      tts: makeTts(),
      clock: () => now,
    });

    const result = await useCase.execute(makeInput());

    expect(result.isOk()).toBe(true);
    const output = result.unwrap();
    expect(output.endReason).toBe(END_INTERVIEW_REASON.ALL_TOPICS_COVERED);
    expect(output.turnsCompleted).toBe(2);
    expect(output.transcript.map((entry) => entry.speaker)).toEqual([
      "agent",
      "candidate",
      "agent",
      "candidate",
      "agent",
    ]);
    expect(output.notes).toHaveLength(1);
    expect(output.internalScores).toHaveLength(1);
    expect(repo.save).toHaveBeenCalledTimes(1 + 2 * 2 + 1 + 1);
  });

  it("does not complete when STT setup fails", async () => {
    const savedStatuses: string[] = [];
    const repo = makeRepo(makeScheduledInterview(), {
      save: vi.fn().mockImplementation(async (next: Interview) => {
        savedStatuses.push(next.status);
        return Result.Ok(next);
      }),
    });
    const sttError = new SttUnavailableError("stt unavailable");
    const useCase = new ConductInterviewUseCase({
      interviews: repo,
      agent: makeAgent([askTurn("Question 1")]),
      stt: makeStt(vi.fn().mockResolvedValue(Result.Err(sttError))),
      tts: makeTts(),
      clock: () => now,
    });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe(sttError);
    expect(savedStatuses.at(-1)).toBe(INTERVIEW_STATUS.IN_PROGRESS);
  });

  it("does not complete when TTS setup fails", async () => {
    const ttsError = new TtsUnavailableError("tts unavailable");
    const repo = makeRepo(makeScheduledInterview());
    const stt = makeStt();
    const useCase = new ConductInterviewUseCase({
      interviews: repo,
      agent: makeAgent([askTurn("Question 1")]),
      stt,
      tts: makeTts(vi.fn().mockResolvedValue(Result.Err(ttsError))),
      clock: () => now,
    });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe(ttsError);
    expect(stt.transcribe).not.toHaveBeenCalled();
  });

  it("does not complete when the agent fails", async () => {
    const agentError = new AgentUnavailableError("agent unavailable");
    const repo = makeRepo(makeScheduledInterview());
    const agent: IInterviewAgentService = {
      runTurn: vi.fn().mockResolvedValue(Result.Err(agentError)),
    };
    const useCase = new ConductInterviewUseCase({
      interviews: repo,
      agent,
      stt: makeStt(),
      tts: makeTts(),
      clock: () => now,
    });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe(agentError);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it("returns a ServiceError when aborted mid-loop", async () => {
    const abortController = new AbortController();
    const useCase = new ConductInterviewUseCase({
      interviews: makeRepo(makeScheduledInterview()),
      agent: makeAgent([askTurn("Question 1")]),
      stt: makeStt(),
      tts: makeTts(),
      clock: () => now,
    });
    const input = makeInput(abortController.signal);
    input.agentAudioOut.mockImplementation(async () => {
      abortController.abort();
    });

    const result = await useCase.execute(input);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe("ConductInterview.abort");
  });

  it("injects time remaining messages at the configured interval", async () => {
    const agent = makeAgent([
      askTurn("Question 1"),
      askTurn("Question 2"),
      askTurn("Question 3"),
      askTurn("Question 4"),
      askTurn("Done", [{ kind: "end_interview", reason: END_INTERVIEW_REASON.ALL_TOPICS_COVERED }]),
    ]);
    const useCase = new ConductInterviewUseCase({
      interviews: makeRepo(makeScheduledInterview()),
      agent,
      stt: makeStt(),
      tts: makeTts(),
      clock: () => now,
      timeRemainingIntervalTurns: 2,
    });

    await useCase.execute(makeInput());

    const messages = vi.mocked(agent.runTurn).mock.calls.map(([input]) => input.timeRemainingMessage);
    expect(messages).toEqual([
      expect.stringContaining("Time check (turn 0)"),
      null,
      expect.stringContaining("Time check (turn 2)"),
      null,
      expect.stringContaining("Time check (turn 4)"),
    ]);
  });

  it("can disable time remaining messages", async () => {
    const agent = makeAgent([
      askTurn("Question 1"),
      askTurn("Done", [{ kind: "end_interview", reason: END_INTERVIEW_REASON.ALL_TOPICS_COVERED }]),
    ]);
    const useCase = new ConductInterviewUseCase({
      interviews: makeRepo(makeScheduledInterview()),
      agent,
      stt: makeStt(),
      tts: makeTts(),
      clock: () => now,
      timeRemainingIntervalTurns: 0,
    });

    await useCase.execute(makeInput());

    const messages = vi.mocked(agent.runTurn).mock.calls.map(([input]) => input.timeRemainingMessage);
    expect(messages).toEqual([null, null]);
  });

  it("returns InvalidInterviewInputError when the agent emits an invalid score", async () => {
    const repo = makeRepo(makeScheduledInterview());
    const useCase = new ConductInterviewUseCase({
      interviews: repo,
      agent: makeAgent([
        askTurn("Question 1", [
          {
            kind: "score_answer",
            topicName: "Backend Architecture",
            score: 6,
            justification: "Too high.",
          },
        ]),
      ]),
      stt: makeStt(),
      tts: makeTts(),
      clock: () => now,
    });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it("injects a hard-ceiling reminder, then aborts if the agent does not end", async () => {
    vi.useFakeTimers();
    const plan = makePlan({ targetDurationMinutes: 1, maxDurationMinutes: 1 });
    const agent = makeAgent(
      [askTurn("Question 1"), askTurn("Wrap up please")],
      () => {
        vi.advanceTimersByTime(90_000);
      },
    );
    const useCase = new ConductInterviewUseCase({
      interviews: makeRepo(makeScheduledInterview(plan)),
      agent,
      stt: makeStt(),
      tts: makeTts(),
      clock: () => now,
      hardCeilingGraceSeconds: 0,
    });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe("ConductInterview.hardCeiling");
    expect(vi.mocked(agent.runTurn).mock.calls[1]?.[0].timeRemainingMessage).toContain(
      "Hard ceiling reached",
    );
  });
});
