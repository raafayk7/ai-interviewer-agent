import { Result } from "@carbonteq/fp";
import {
  AgentInternalScore,
  InterviewNotFoundError,
  type IInterviewRepository,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";
import type { WebhookReceiverOutput } from "./start-interview-from-webhook.use-case.js";

export interface RecordInternalScoreInput {
  readonly interviewId: string;
  readonly topicName: string;
  readonly score: number;
  readonly justification: string;
  readonly recordedAtTurn?: number;
  readonly recordedAt: Date;
}

export class RecordInternalScoreUseCase extends UseCase<
  RecordInternalScoreInput,
  WebhookReceiverOutput
> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(
    input: RecordInternalScoreInput,
  ): Promise<Result<WebhookReceiverOutput, ServiceError>> {
    const scoreResult = AgentInternalScore.create({
      topicName: input.topicName,
      score: input.score,
      justification: input.justification,
      recordedAtTurn: input.recordedAtTurn ?? 0,
      recordedAt: input.recordedAt,
    });
    if (scoreResult.isErr()) {
      return Result.Err(scoreResult.unwrapErr() as ServiceError);
    }

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

    const appended = interviewOrError.unwrap().appendInternalScore(scoreResult.unwrap());
    if (appended.isErr()) {
      return Result.Ok({ applied: false });
    }

    const saved = await this.interviews.save(appended.unwrap());
    if (saved.isErr()) {
      return Result.Err(
        new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"),
      );
    }

    return Result.Ok({ applied: true });
  }
}
