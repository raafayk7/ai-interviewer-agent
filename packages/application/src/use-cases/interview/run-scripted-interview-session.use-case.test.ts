import { Result } from "@carbonteq/fp";
import { SPEAKER } from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import {
  SttUnavailableError,
  type ISpeechToTextService,
  type TranscriptChunk,
} from "../../ports/speech-to-text/index.js";
import {
  TtsUnavailableError,
  type ITextToSpeechService,
} from "../../ports/text-to-speech/index.js";
import {
  SCRIPT_VERSION,
  SCRIPTED_INTERVIEW_QUESTIONS,
} from "./scripted-interview-script.js";
import { RunScriptedInterviewSessionUseCase } from "./run-scripted-interview-session.use-case.js";

const audioChunk = (value: number): Uint8Array => Uint8Array.from([value]);

async function* audioChunks(values: number[]): AsyncIterable<Uint8Array> {
  for (const value of values) {
    yield audioChunk(value);
  }
}

async function* transcriptChunks(
  values: ReadonlyArray<Pick<TranscriptChunk, "text" | "isFinal">>,
): AsyncIterable<TranscriptChunk> {
  for (const value of values) {
    yield {
      ...value,
      receivedAt: new Date("2026-05-10T00:00:00Z"),
    };
  }
}

function throwingTranscript(): AsyncIterable<TranscriptChunk> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(new Error("stt stream broke")),
    }),
  };
}

const makeTts = (
  synthesize = vi.fn().mockImplementation(() => Promise.resolve(Result.Ok(audioChunks([1, 2])))),
): ITextToSpeechService => ({ synthesize });

const makeStt = (
  transcribe = vi.fn().mockImplementation((_audio: AsyncIterable<Uint8Array>, ctx) =>
    Promise.resolve(
      Result.Ok(
        transcriptChunks([
          {
            text: `answer ${ctx.turnIndex}`,
            isFinal: true,
          },
        ]),
      ),
    ),
  ),
): ISpeechToTextService => ({ transcribe });

const makeInput = (overrides: Partial<Parameters<RunScriptedInterviewSessionUseCase["execute"]>[0]> = {}) => ({
  interviewId: "interview-001",
  candidateAudioIn: audioChunks([10, 11, 12, 13]),
  agentAudioOut: vi.fn().mockResolvedValue(undefined),
  abortSignal: new AbortController().signal,
  clock: () => new Date("2026-05-10T10:00:00Z"),
  ...overrides,
});

describe("RunScriptedInterviewSessionUseCase", () => {
  it("synthesizes every scripted question, captures answers, and returns transcript entries", async () => {
    const tts = makeTts();
    const stt = makeStt();
    const useCase = new RunScriptedInterviewSessionUseCase({ stt, tts });
    const input = makeInput();

    const result = await useCase.execute(input);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      interviewId: "interview-001",
      transcript: expect.any(Array),
      turnsCompleted: SCRIPTED_INTERVIEW_QUESTIONS.length,
      scriptVersion: SCRIPT_VERSION,
    });
    expect(result.unwrap().transcript).toHaveLength(SCRIPTED_INTERVIEW_QUESTIONS.length * 2);
    expect(tts.synthesize).toHaveBeenCalledTimes(SCRIPTED_INTERVIEW_QUESTIONS.length);
    expect(stt.transcribe).toHaveBeenCalledTimes(SCRIPTED_INTERVIEW_QUESTIONS.length);
    expect(input.agentAudioOut).toHaveBeenCalledTimes(SCRIPTED_INTERVIEW_QUESTIONS.length * 2);
  });

  it("marks agent and candidate transcript entries with the correct speakers", async () => {
    const useCase = new RunScriptedInterviewSessionUseCase({
      stt: makeStt(),
      tts: makeTts(),
    });

    const result = await useCase.execute(makeInput());

    expect(result.isOk()).toBe(true);
    const speakers = result.unwrap().transcript.map((entry) => entry.speaker);
    expect(speakers).toEqual([
      SPEAKER.AGENT,
      SPEAKER.CANDIDATE,
      SPEAKER.AGENT,
      SPEAKER.CANDIDATE,
      SPEAKER.AGENT,
      SPEAKER.CANDIDATE,
      SPEAKER.AGENT,
      SPEAKER.CANDIDATE,
    ]);
  });

  it("returns STT setup errors unchanged and does not continue to the next turn", async () => {
    const sttError = new SttUnavailableError("stt unavailable");
    const stt = makeStt(vi.fn().mockResolvedValue(Result.Err(sttError)));
    const tts = makeTts();
    const useCase = new RunScriptedInterviewSessionUseCase({ stt, tts });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe(sttError);
    expect(tts.synthesize).toHaveBeenCalledTimes(1);
    expect(stt.transcribe).toHaveBeenCalledTimes(1);
  });

  it("returns TTS setup errors unchanged and does not start STT", async () => {
    const ttsError = new TtsUnavailableError("tts unavailable");
    const tts = makeTts(vi.fn().mockResolvedValue(Result.Err(ttsError)));
    const stt = makeStt();
    const useCase = new RunScriptedInterviewSessionUseCase({ stt, tts });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe(ttsError);
    expect(tts.synthesize).toHaveBeenCalledTimes(1);
    expect(stt.transcribe).not.toHaveBeenCalled();
  });

  it("maps mid-stream STT errors to ServiceUnknownError", async () => {
    const stt = makeStt(vi.fn().mockResolvedValue(Result.Ok(throwingTranscript())));
    const useCase = new RunScriptedInterviewSessionUseCase({
      stt,
      tts: makeTts(),
    });

    const result = await useCase.execute(makeInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe(
      "RunScriptedInterviewSession.stt.consume",
    );
  });

  it("returns partial success when the abort signal flips during TTS streaming", async () => {
    const abortController = new AbortController();
    const agentAudioOut = vi.fn().mockImplementation(async () => {
      abortController.abort();
    });
    const tts = makeTts();
    const stt = makeStt();
    const useCase = new RunScriptedInterviewSessionUseCase({ stt, tts });

    const result = await useCase.execute(
      makeInput({
        agentAudioOut,
        abortSignal: abortController.signal,
      }),
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().transcript).toEqual([]);
    expect(result.unwrap().turnsCompleted).toBe(0);
    expect(tts.synthesize).toHaveBeenCalledTimes(1);
    expect(stt.transcribe).not.toHaveBeenCalled();
  });
});
