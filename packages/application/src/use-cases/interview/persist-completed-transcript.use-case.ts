import { Result } from "@carbonteq/fp";
import {
  INTERVIEW_STATUS,
  InterviewNotFoundError,
  InvalidInterviewInputError,
  TranscriptEntry,
  type IInterviewRepository,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";
import type { IConversationalAgentService } from "../../ports/conversational-agent/index.js";

export interface PersistCompletedTranscriptInput {
  readonly interviewId: string;
  readonly elevenLabsSessionId: string;
  readonly occurredAt: Date;
}

export interface PersistCompletedTranscriptOutput {
  readonly applied: boolean;
  readonly entryCount: number;
}

export class PersistCompletedTranscriptUseCase extends UseCase<
  PersistCompletedTranscriptInput,
  PersistCompletedTranscriptOutput
> {
  constructor(
    private readonly interviews: IInterviewRepository,
    private readonly agent: IConversationalAgentService,
  ) {
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

    const rowsResult = await this.agent.getTranscript(input.elevenLabsSessionId);
    if (rowsResult.isErr()) {
      return Result.Err(rowsResult.unwrapErr() as ServiceError);
    }

    const entryResults = rowsResult
      .unwrap()
      .filter((row) => row.text.trim().length > 0)
      .map((row) =>
        TranscriptEntry.create({
          speaker: row.speaker,
          text: row.text,
          timestamp: row.timestamp,
        }),
      );
    const entriesResult =
      entryResults.length === 0
        ? Result.Ok([])
        : Result.all(...entryResults);
    if (entriesResult.isErr()) {
      return Result.Err(
        (entriesResult.unwrapErr()[0] ??
          new InvalidInterviewInputError("Transcript entries are invalid")) as ServiceError,
      );
    }

    const entries = entriesResult.unwrap();
    const completed = interview.complete(input.occurredAt, entries);
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
