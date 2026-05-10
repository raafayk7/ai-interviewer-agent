import { Result } from "@carbonteq/fp";
import {
  AgentInternalScore,
  AgentNote,
  INTERVIEW_STATUS,
  Interview,
  InterviewNotFoundError,
  InvalidInterviewInputError,
  SPEAKER,
  TranscriptEntry,
  type IInterviewRepository,
} from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import {
  ServiceUnknownError,
  type ServiceError,
} from "../../core/service-error.js";
import type { ConductInterviewOutput } from "../../dtos/conduct-interview.dto.js";
import type {
  AgentMessage,
  AgentToolEvent,
  EndInterviewReason,
  IInterviewAgentService,
} from "../../ports/interview-agent/index.js";
import type {
  ISpeechToTextService,
  TranscriptChunk,
} from "../../ports/speech-to-text/index.js";
import type { ITextToSpeechService } from "../../ports/text-to-speech/index.js";
import { createCandidateAudioTurnGate } from "./candidate-audio-turn-gate.js";
import { assembleInterviewSystemPrompt } from "./system-prompt-assembler.js";

export interface ConductInterviewDeps {
  readonly interviews: IInterviewRepository;
  readonly agent: IInterviewAgentService;
  readonly stt: ISpeechToTextService;
  readonly tts: ITextToSpeechService;
  readonly clock?: () => Date;
  /** Inject the time-remaining message every K turns. 0 disables. Default 3. */
  readonly timeRemainingIntervalTurns?: number;
  /** Hard-ceiling grace period after `maxDurationMinutes` elapses. Default 30s. */
  readonly hardCeilingGraceSeconds?: number;
}

export interface ConductInterviewRuntimeInput {
  readonly interviewId: string;
  readonly candidateAudioIn: AsyncIterable<Uint8Array>;
  readonly agentAudioOut: (chunk: Uint8Array) => Promise<void>;
  readonly abortSignal: AbortSignal;
}

export class ConductInterviewUseCase extends UseCase<
  ConductInterviewRuntimeInput,
  ConductInterviewOutput
> {
  constructor(private readonly deps: ConductInterviewDeps) {
    super();
  }

  async execute(
    input: ConductInterviewRuntimeInput,
  ): Promise<Result<ConductInterviewOutput, ServiceError>> {
    const clock = this.deps.clock ?? (() => new Date());
    const interval = this.deps.timeRemainingIntervalTurns ?? 3;
    const graceSeconds = this.deps.hardCeilingGraceSeconds ?? 30;

    const loadResult = await this.deps.interviews.findById(input.interviewId);
    if (loadResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          loadResult.unwrapErr().message,
          "InterviewRepository.findById",
        ),
      );
    }

    const interviewOrError = loadResult.unwrap().match({
      Some: (loaded) => Result.Ok(loaded),
      None: () => Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
    });
    if (interviewOrError.isErr()) {
      return interviewOrError;
    }

    let interview = interviewOrError.unwrap();
    const planOrError = interview.interviewPlan.match({
      Some: (plan) => Result.Ok(plan),
      None: () =>
        Result.Err(
          new InvalidInterviewInputError(
            "Interview cannot be conducted without an InterviewPlan; run GenerateInterviewPlan first.",
          ) as ServiceError,
        ),
    });
    if (planOrError.isErr()) {
      return planOrError;
    }
    const plan = planOrError.unwrap();

    const sessionStartedAt = clock();
    const startResult = interview.start(sessionStartedAt);
    if (startResult.isErr()) {
      return Result.Err(startResult.unwrapErr() as ServiceError);
    }
    interview = startResult.unwrap();

    const persistStart = await this.persist(interview);
    if (persistStart.isErr()) {
      return persistStart;
    }
    interview = persistStart.unwrap();

    const ownAbortController = new AbortController();
    let hardCeilingHit = false;
    let hardCeilingReminderTurn: number | null = null;
    const ceilingTimer = setTimeout(() => {
      hardCeilingHit = true;
    }, plan.maxDurationMinutes * 60_000 + graceSeconds * 1000);

    input.abortSignal.addEventListener(
      "abort",
      () => ownAbortController.abort(),
      { once: true },
    );

    const systemPrompt = assembleInterviewSystemPrompt({
      jobDescription: interview.jobDescription,
      candidateInfo: interview.candidateInfo,
      clientInstructions: interview.clientInstructions,
      interviewPlan: plan,
    });
    const history: AgentMessage[] = [];
    const candidateAudio = createCandidateAudioTurnGate(input.candidateAudioIn);
    let turnIndex = 0;
    let endReason: EndInterviewReason | null = null;
    let agentEndedThisTurn = false;
    let lastError: ServiceError | null = null;

    while (!input.abortSignal.aborted && !ownAbortController.signal.aborted) {
      if (hardCeilingReminderTurn !== null && turnIndex > hardCeilingReminderTurn) {
        ownAbortController.abort();
        lastError = new ServiceUnknownError(
          `Interview ${input.interviewId} exceeded hard ceiling`,
          "ConductInterview.hardCeiling",
        );
        break;
      }

      const timeRemainingMessage = this.buildTimeRemaining(
        plan,
        sessionStartedAt,
        clock(),
        turnIndex,
        interval,
        hardCeilingHit,
      );
      if (hardCeilingHit && hardCeilingReminderTurn === null) {
        hardCeilingReminderTurn = turnIndex;
      }

      const turnResult = await this.deps.agent.runTurn({
        interviewId: input.interviewId,
        turnIndex,
        systemPrompt,
        conversationHistory: history,
        timeRemainingMessage,
        abortSignal: ownAbortController.signal,
      });
      if (turnResult.isErr()) {
        lastError = turnResult.unwrapErr() as ServiceError;
        break;
      }

      const turn = turnResult.unwrap();
      agentEndedThisTurn = false;

      for (const event of turn.toolEvents) {
        const applied = await this.applyToolEvent(interview, event, turnIndex, clock);
        if (applied.isErr()) {
          lastError = applied.unwrapErr();
          break;
        }
        interview = applied.unwrap();
        if (event.kind === "end_interview") {
          endReason = event.reason;
          agentEndedThisTurn = true;
        }
      }
      if (lastError) break;

      const agentEntryResult = TranscriptEntry.create({
        speaker: SPEAKER.AGENT,
        text: turn.text,
        timestamp: clock(),
      });
      if (agentEntryResult.isErr()) {
        lastError = agentEntryResult.unwrapErr() as ServiceError;
        break;
      }

      const appendAgent = interview.appendTranscriptEntry(agentEntryResult.unwrap());
      if (appendAgent.isErr()) {
        lastError = appendAgent.unwrapErr() as ServiceError;
        break;
      }
      interview = appendAgent.unwrap();
      history.push({ role: "assistant", content: turn.text });

      const persistAgent = await this.persist(interview);
      if (persistAgent.isErr()) {
        lastError = persistAgent.unwrapErr();
        break;
      }
      interview = persistAgent.unwrap();

      const speakResult = await this.speakTurn(turn.text, input.interviewId, turnIndex, input);
      if (speakResult.isErr()) {
        lastError = speakResult.unwrapErr();
        break;
      }

      if (agentEndedThisTurn) {
        break;
      }

      if (hardCeilingReminderTurn === turnIndex) {
        ownAbortController.abort();
        lastError = new ServiceUnknownError(
          `Interview ${input.interviewId} exceeded hard ceiling`,
          "ConductInterview.hardCeiling",
        );
        break;
      }

      const answerAudio = candidateAudio.nextTurn();
      const sttResult = await this.deps.stt.transcribe(answerAudio, {
        interviewId: input.interviewId,
        turnIndex,
      });
      if (sttResult.isErr()) {
        candidateAudio.close();
        lastError = sttResult.unwrapErr() as ServiceError;
        break;
      }

      const finalTextResult = await this.collectFinalTranscript(
        sttResult.unwrap(),
        input.abortSignal,
      );
      candidateAudio.endTurn();
      if (finalTextResult.isErr()) {
        lastError = finalTextResult.unwrapErr();
        break;
      }
      if (input.abortSignal.aborted) break;

      const candidateEntryResult = TranscriptEntry.create({
        speaker: SPEAKER.CANDIDATE,
        text: finalTextResult.unwrap(),
        timestamp: clock(),
      });
      if (candidateEntryResult.isErr()) {
        lastError = candidateEntryResult.unwrapErr() as ServiceError;
        break;
      }

      const appendCandidate = interview.appendTranscriptEntry(candidateEntryResult.unwrap());
      if (appendCandidate.isErr()) {
        lastError = appendCandidate.unwrapErr() as ServiceError;
        break;
      }
      interview = appendCandidate.unwrap();
      history.push({ role: "user", content: finalTextResult.unwrap() });

      const persistCandidate = await this.persist(interview);
      if (persistCandidate.isErr()) {
        lastError = persistCandidate.unwrapErr();
        break;
      }
      interview = persistCandidate.unwrap();
      turnIndex += 1;
    }
    candidateAudio.close();
    clearTimeout(ceilingTimer);

    if (!lastError && (input.abortSignal.aborted || ownAbortController.signal.aborted)) {
      lastError = new ServiceUnknownError(
        `Interview ${input.interviewId} was aborted`,
        "ConductInterview.abort",
      );
    }

    if (lastError && interview.status === INTERVIEW_STATUS.IN_PROGRESS) {
      return Result.Err(lastError);
    }

    if (interview.status === INTERVIEW_STATUS.IN_PROGRESS) {
      const completeResult = interview.complete(clock(), interview.transcript);
      if (completeResult.isErr()) {
        return Result.Err(completeResult.unwrapErr() as ServiceError);
      }
      interview = completeResult.unwrap();

      const persistComplete = await this.persist(interview);
      if (persistComplete.isErr()) {
        return persistComplete;
      }
      interview = persistComplete.unwrap();
    }

    return Result.Ok({
      interviewId: interview.id,
      turnsCompleted: turnIndex,
      transcript: interview.transcript.map((entry) => entry.serialize()),
      notes: interview.notes.map((note) => note.serialize()),
      internalScores: interview.internalScores.map((score) => score.serialize()),
      endReason,
      hardCeilingHit,
    });
  }

  private async applyToolEvent(
    interview: Interview,
    event: AgentToolEvent,
    turnIndex: number,
    clock: () => Date,
  ): Promise<Result<Interview, ServiceError>> {
    switch (event.kind) {
      case "next_question":
        return Result.Ok(interview);
      case "score_answer": {
        const scoreResult = AgentInternalScore.create({
          topicName: event.topicName,
          score: event.score,
          justification: event.justification,
          recordedAtTurn: turnIndex,
          recordedAt: clock(),
        });
        if (scoreResult.isErr()) {
          return Result.Err(scoreResult.unwrapErr() as ServiceError);
        }
        return interview
          .appendInternalScore(scoreResult.unwrap())
          .mapErr((error) => error as ServiceError);
      }
      case "take_note": {
        const noteResult = AgentNote.create({
          note: event.note,
          recordedAtTurn: turnIndex,
          recordedAt: clock(),
        });
        if (noteResult.isErr()) {
          return Result.Err(noteResult.unwrapErr() as ServiceError);
        }
        return interview
          .appendNote(noteResult.unwrap())
          .mapErr((error) => error as ServiceError);
      }
      case "end_interview":
        return Result.Ok(interview);
    }
  }

  private async persist(interview: Interview): Promise<Result<Interview, ServiceError>> {
    const saveResult = await this.deps.interviews.save(interview);
    if (saveResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(saveResult.unwrapErr().message, "InterviewRepository.save"),
      );
    }
    return Result.Ok(saveResult.unwrap());
  }

  private async speakTurn(
    text: string,
    interviewId: string,
    turnIndex: number,
    input: ConductInterviewRuntimeInput,
  ): Promise<Result<void, ServiceError>> {
    const ttsResult = await this.deps.tts.synthesize(text, {
      interviewId,
      turnIndex,
    });
    if (ttsResult.isErr()) {
      return Result.Err(ttsResult.unwrapErr() as ServiceError);
    }

    return Result.tryAsyncCatch(
      async () => {
        for await (const chunk of ttsResult.unwrap()) {
          if (input.abortSignal.aborted) break;
          await input.agentAudioOut(chunk);
        }
      },
      (err) =>
        new ServiceUnknownError(
          err instanceof Error ? err.message : String(err),
          "ConductInterview.tts.consume",
        ),
    ).toPromise();
  }

  private async collectFinalTranscript(
    chunks: AsyncIterable<TranscriptChunk>,
    abortSignal: AbortSignal,
  ): Promise<Result<string, ServiceError>> {
    return Result.tryAsyncCatch(
      async () => {
        const text: string[] = [];
        for await (const chunk of chunks) {
          if (abortSignal.aborted) break;
          if (chunk.isFinal) {
            text.push(chunk.text);
            break;
          }
        }
        return text.join(" ").trim();
      },
      (err) =>
        new ServiceUnknownError(
          err instanceof Error ? err.message : String(err),
          "ConductInterview.stt.consume",
        ),
    ).toPromise();
  }

  private buildTimeRemaining(
    plan: { readonly targetDurationMinutes: number; readonly maxDurationMinutes: number },
    startedAt: Date,
    now: Date,
    turnIndex: number,
    interval: number,
    hardCeilingHit: boolean,
  ): string | null {
    if (hardCeilingHit) {
      return "Hard ceiling reached. End the interview now with end_interview(reason: 'time_up').";
    }
    if (interval <= 0) return null;
    if (turnIndex % interval !== 0) return null;

    const elapsedMs = now.getTime() - startedAt.getTime();
    const targetRemainingMs = Math.max(0, plan.targetDurationMinutes * 60_000 - elapsedMs);
    const maxRemainingMs = Math.max(0, plan.maxDurationMinutes * 60_000 - elapsedMs);
    const formatDuration = (ms: number): string => {
      const seconds = Math.round(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const remainder = seconds % 60;
      return `${minutes}:${String(remainder).padStart(2, "0")}`;
    };

    return `Time check (turn ${turnIndex}): ${formatDuration(targetRemainingMs)} remaining of soft target, ${formatDuration(maxRemainingMs)} before hard ceiling.`;
  }
}
