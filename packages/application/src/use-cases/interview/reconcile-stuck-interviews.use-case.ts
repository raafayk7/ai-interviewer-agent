import { Result } from "@carbonteq/fp";
import {
  InvalidInterviewInputError,
  TranscriptEntry,
  type IInterviewRepository,
  type Interview,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";
import type {
  ConversationalTranscriptRow,
  IConversationalAgentService,
} from "../../ports/conversational-agent/index.js";

export interface ReconcileStuckInterviewsInput {
  readonly thresholdMinutes: number;
  readonly now?: Date;
}

export interface ReconcileStuckInterviewsOutput {
  readonly scanned: number;
  readonly completed: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<string>;
}

export class ReconcileStuckInterviewsUseCase extends UseCase<
  ReconcileStuckInterviewsInput,
  ReconcileStuckInterviewsOutput
> {
  constructor(
    private readonly interviews: IInterviewRepository,
    private readonly agent: IConversationalAgentService,
  ) {
    super();
  }

  async execute(
    input: ReconcileStuckInterviewsInput,
  ): Promise<Result<ReconcileStuckInterviewsOutput, ServiceError>> {
    const now = input.now ?? new Date();
    const cutoff = new Date(now.getTime() - input.thresholdMinutes * 60_000);
    const stuckResult = await this.interviews.findStuckInProgress(cutoff);
    if (stuckResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          stuckResult.unwrapErr().message,
          "InterviewRepository.findStuckInProgress",
        ),
      );
    }

    const stuck = stuckResult.unwrap();
    const completed: string[] = [];
    const failed: string[] = [];

    for (const interview of stuck) {
      if (interview.elevenLabsSessionId.isNone()) {
        const failResult = await this.failInterview(
          interview,
          "no elevenLabsSessionId bound",
        );
        if (failResult.isErr()) return failResult;
        failed.push(interview.id);
        continue;
      }

      const sessionId = interview.elevenLabsSessionId.unwrap();
      const transcriptResult = await this.agent.getTranscript(sessionId);
      if (transcriptResult.isErr()) {
        const failResult = await this.failInterview(
          interview,
          transcriptResult.unwrapErr().message,
        );
        if (failResult.isErr()) return failResult;
        failed.push(interview.id);
        continue;
      }

      const entriesResult = toTranscriptEntries(transcriptResult.unwrap());
      if (entriesResult.isErr() || entriesResult.unwrap().length === 0) {
        const failResult = await this.failInterview(
          interview,
          "transcript empty or invalid",
        );
        if (failResult.isErr()) return failResult;
        failed.push(interview.id);
        continue;
      }

      const completeResult = interview.complete(now, entriesResult.unwrap());
      if (completeResult.isErr()) {
        const failResult = await this.failInterview(interview, completeResult.unwrapErr().message);
        if (failResult.isErr()) return failResult;
        failed.push(interview.id);
        continue;
      }

      const saved = await this.interviews.save(completeResult.unwrap());
      if (saved.isErr()) {
        return Result.Err(
          new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"),
        );
      }
      completed.push(interview.id);
    }

    return Result.Ok({ scanned: stuck.length, completed, failed });
  }

  private async failInterview(
    interview: Interview,
    reason: string,
  ): Promise<Result<void, ServiceError>> {
    const failed = interview.fail(reason);
    if (failed.isErr()) {
      return Result.Err(failed.unwrapErr() as ServiceError);
    }

    const saved = await this.interviews.save(failed.unwrap());
    if (saved.isErr()) {
      return Result.Err(
        new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"),
      );
    }

    return Result.Ok(undefined);
  }
}

function toTranscriptEntries(
  rows: ReadonlyArray<ConversationalTranscriptRow>,
): Result<ReadonlyArray<TranscriptEntry>, ServiceError> {
  const entryResults = rows
    .filter((row) => row.text.trim().length > 0)
    .map((row) =>
      TranscriptEntry.create({
        speaker: row.speaker,
        text: row.text,
        timestamp: row.timestamp,
      }),
    );

  const entriesResult = entryResults.length === 0 ? Result.Ok([]) : Result.all(...entryResults);
  if (entriesResult.isErr()) {
    return Result.Err(
      (entriesResult.unwrapErr()[0] ??
        new InvalidInterviewInputError("Transcript entries are invalid")) as ServiceError,
    );
  }

  return Result.Ok(entriesResult.unwrap());
}
