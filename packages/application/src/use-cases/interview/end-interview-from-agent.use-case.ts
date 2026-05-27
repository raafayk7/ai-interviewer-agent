import { Result } from "@carbonteq/fp";
import {
  AgentNote,
  InterviewNotFoundError,
  type IInterviewRepository,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";
import type { WebhookReceiverOutput } from "./start-interview-from-webhook.use-case.js";

export interface EndInterviewFromAgentInput {
  readonly interviewId: string;
  readonly reason: string;
  readonly recordedAtTurn?: number;
  readonly recordedAt: Date;
}

export class EndInterviewFromAgentUseCase extends UseCase<
  EndInterviewFromAgentInput,
  WebhookReceiverOutput
> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(
    input: EndInterviewFromAgentInput,
  ): Promise<Result<WebhookReceiverOutput, ServiceError>> {
    const noteResult = AgentNote.create({
      note: `[end_call] reason=${input.reason}`,
      recordedAtTurn: input.recordedAtTurn ?? 0,
      recordedAt: input.recordedAt,
    });
    if (noteResult.isErr()) {
      return Result.Err(noteResult.unwrapErr() as ServiceError);
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

    const appended = interviewOrError.unwrap().appendNote(noteResult.unwrap());
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
