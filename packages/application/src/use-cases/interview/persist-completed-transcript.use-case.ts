import { Result } from "@carbonteq/fp";
import {
  INTERVIEW_STATUS,
  InterviewNotFoundError,
  InvalidInterviewInputError,
  SPEAKER,
  TranscriptEntry,
  AgentNote,
  type IInterviewRepository,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";

export interface PostCallToolResult {
  readonly resultType: string;
  readonly resultValue?: { readonly reason?: string; readonly message?: string };
}

export interface PostCallTranscriptEntry {
  readonly role: "agent" | "user";
  readonly message: string | null;
  readonly timeInCallSecs: number;
  readonly toolResults: ReadonlyArray<PostCallToolResult> | null;
}

export interface PersistCompletedTranscriptInput {
  readonly interviewId: string;
  readonly elevenLabsSessionId: string;
  readonly occurredAt: Date;
  readonly transcript: ReadonlyArray<PostCallTranscriptEntry>;
}

export interface PersistCompletedTranscriptOutput {
  readonly applied: boolean;
  readonly entryCount: number;
}

export class PersistCompletedTranscriptUseCase extends UseCase<
  PersistCompletedTranscriptInput,
  PersistCompletedTranscriptOutput
> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(
    input: PersistCompletedTranscriptInput,
  ): Promise<Result<PersistCompletedTranscriptOutput, ServiceError>> {
    const found = await this.interviews.findById(input.interviewId);
    if (found.isErr()) {
      return Result.Err(
        new ServiceUnknownError(found.unwrapErr().message, "InterviewRepository.findById"),
      );
    }

    const interviewOrError = found.unwrap().match({
      Some: (interview) => Result.Ok(interview),
      None: () => Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
    });
    if (interviewOrError.isErr()) {
      return interviewOrError;
    }

    const interview = interviewOrError.unwrap();
    if (
      interview.status === INTERVIEW_STATUS.COMPLETED ||
      interview.status === INTERVIEW_STATUS.EVALUATED
    ) {
      return Result.Ok({ applied: false, entryCount: 0 });
    }

    // Walk the transcript for an end_call_success tool result and append a note.
    const endCall = findEndCallSuccess(input.transcript);
    let intermediate = interview;
    if (endCall) {
      const reason = endCall.reason ?? "agent_requested_end_call";
      const noteText = `[end_call] reason=${reason}${endCall.message ? ` — ${endCall.message}` : ""}`;
      const noteResult = AgentNote.create({
        note: noteText,
        recordedAtTurn: 0,
        recordedAt: input.occurredAt,
      });
      if (noteResult.isOk()) {
        const appended = intermediate.appendNote(noteResult.unwrap());
        if (appended.isOk()) {
          intermediate = appended.unwrap();
        }
      }
    }

    const entryResults = input.transcript
      .filter(
        (row) =>
          (row.role === "agent" || row.role === "user") &&
          (row.message ?? "").trim().length > 0,
      )
      .map((row) =>
        TranscriptEntry.create({
          speaker: row.role === "agent" ? SPEAKER.AGENT : SPEAKER.CANDIDATE,
          text: row.message ?? "",
          timestamp: new Date(input.occurredAt.getTime() + row.timeInCallSecs * 1000),
        }),
      );

    const entriesResult =
      entryResults.length === 0 ? Result.Ok([]) : Result.all(...entryResults);
    if (entriesResult.isErr()) {
      return Result.Err(
        (entriesResult.unwrapErr()[0] ??
          new InvalidInterviewInputError("Transcript entries are invalid")) as ServiceError,
      );
    }

    const entries = entriesResult.unwrap();
    const completed = intermediate.complete(input.occurredAt, entries);
    if (completed.isErr()) {
      return Result.Ok({ applied: false, entryCount: 0 });
    }

    const saved = await this.interviews.save(completed.unwrap());
    if (saved.isErr()) {
      return Result.Err(
        new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"),
      );
    }

    return Result.Ok({ applied: true, entryCount: entries.length });
  }
}

function findEndCallSuccess(
  transcript: ReadonlyArray<PostCallTranscriptEntry>,
): { readonly reason?: string; readonly message?: string } | null {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const results = transcript[i]?.toolResults ?? null;
    if (!results) continue;
    const hit = results.find((r) => r.resultType === "end_call_success");
    if (hit) return { reason: hit.resultValue?.reason, message: hit.resultValue?.message };
  }
  return null;
}
