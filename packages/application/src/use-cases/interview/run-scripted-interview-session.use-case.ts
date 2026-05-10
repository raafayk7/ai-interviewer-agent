import { Result } from "@carbonteq/fp";
import {
  SPEAKER,
  TranscriptEntry,
  type TranscriptEntryProps,
} from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import {
  ServiceUnknownError,
  type ServiceError,
} from "../../core/service-error.js";
import type { RunScriptedInterviewSessionOutput } from "../../dtos/run-scripted-interview-session.dto.js";
import type {
  ISpeechToTextService,
  TranscriptChunk,
} from "../../ports/speech-to-text/index.js";
import type { ITextToSpeechService } from "../../ports/text-to-speech/index.js";
import {
  SCRIPT_VERSION,
  SCRIPTED_INTERVIEW_QUESTIONS,
} from "./scripted-interview-script.js";
import { teeCandidateAudio } from "./scripted-interview-tee.js";

export interface RunScriptedInterviewSessionDeps {
  readonly stt: ISpeechToTextService;
  readonly tts: ITextToSpeechService;
}

export interface RunScriptedInterviewSessionRuntimeInput {
  readonly interviewId: string;
  readonly candidateAudioIn: AsyncIterable<Uint8Array>;
  readonly agentAudioOut: (chunk: Uint8Array) => Promise<void>;
  readonly abortSignal: AbortSignal;
  readonly clock?: () => Date;
}

export class RunScriptedInterviewSessionUseCase extends UseCase<
  RunScriptedInterviewSessionRuntimeInput,
  RunScriptedInterviewSessionOutput
> {
  constructor(private readonly deps: RunScriptedInterviewSessionDeps) {
    super();
  }

  async execute(
    input: RunScriptedInterviewSessionRuntimeInput,
  ): Promise<Result<RunScriptedInterviewSessionOutput, ServiceError>> {
    const clock = input.clock ?? (() => new Date());
    const transcript: TranscriptEntryProps[] = [];
    const candidateAudio = teeCandidateAudio(input.candidateAudioIn);
    let turnsCompleted = 0;

    for (let turnIndex = 0; turnIndex < SCRIPTED_INTERVIEW_QUESTIONS.length; turnIndex += 1) {
      if (input.abortSignal.aborted) break;

      const question = SCRIPTED_INTERVIEW_QUESTIONS[turnIndex] as string;
      const ttsResult = await this.deps.tts.synthesize(question, {
        interviewId: input.interviewId,
        turnIndex,
      });
      if (ttsResult.isErr()) {
        candidateAudio.closeAll();
        return Result.Err(ttsResult.unwrapErr() as ServiceError);
      }

      const speakResult = await this.consumeAgentAudio(
        ttsResult.unwrap(),
        input.agentAudioOut,
        input.abortSignal,
      );
      if (speakResult.isErr()) {
        candidateAudio.closeAll();
        return speakResult;
      }
      if (input.abortSignal.aborted) break;

      const agentEntryResult = TranscriptEntry.create({
        speaker: SPEAKER.AGENT,
        text: question,
        timestamp: clock(),
      });
      if (agentEntryResult.isErr()) {
        candidateAudio.closeAll();
        return Result.Err(agentEntryResult.unwrapErr() as ServiceError);
      }
      transcript.push(agentEntryResult.unwrap().serialize());

      const answerAudio = candidateAudio.next();
      const sttResult = await this.deps.stt.transcribe(answerAudio, {
        interviewId: input.interviewId,
        turnIndex,
      });
      if (sttResult.isErr()) {
        candidateAudio.closeAll();
        return Result.Err(sttResult.unwrapErr() as ServiceError);
      }

      const finalTranscriptResult = await this.collectFinalTranscript(
        sttResult.unwrap(),
        input.abortSignal,
      );
      candidateAudio.endCurrent();
      if (finalTranscriptResult.isErr()) {
        candidateAudio.closeAll();
        return finalTranscriptResult;
      }
      if (input.abortSignal.aborted) break;

      const candidateEntryResult = TranscriptEntry.create({
        speaker: SPEAKER.CANDIDATE,
        text: finalTranscriptResult.unwrap(),
        timestamp: clock(),
      });
      if (candidateEntryResult.isErr()) {
        candidateAudio.closeAll();
        return Result.Err(candidateEntryResult.unwrapErr() as ServiceError);
      }
      transcript.push(candidateEntryResult.unwrap().serialize());
      turnsCompleted += 1;
    }

    candidateAudio.closeAll();
    return Result.Ok({
      interviewId: input.interviewId,
      transcript,
      turnsCompleted,
      scriptVersion: SCRIPT_VERSION,
    });
  }

  private async consumeAgentAudio(
    audio: AsyncIterable<Uint8Array>,
    sink: (chunk: Uint8Array) => Promise<void>,
    abortSignal: AbortSignal,
  ): Promise<Result<void, ServiceError>> {
    return Result.tryAsyncCatch(
      async () => {
        for await (const chunk of audio) {
          if (abortSignal.aborted) break;
          await sink(chunk);
        }
      },
      (err) =>
        new ServiceUnknownError(
          err instanceof Error ? err.message : String(err),
          "RunScriptedInterviewSession.tts.consume",
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
          "RunScriptedInterviewSession.stt.consume",
        ),
    ).toPromise();
  }
}
