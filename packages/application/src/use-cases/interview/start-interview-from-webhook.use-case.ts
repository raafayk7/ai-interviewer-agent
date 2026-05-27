import { Result } from "@carbonteq/fp";
import {
  INTERVIEW_STATUS,
  InterviewNotFoundError,
  type IInterviewRepository,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";

export interface StartFromWebhookInput {
  readonly interviewId: string;
  readonly elevenLabsSessionId: string;
  readonly occurredAt: Date;
}

export interface WebhookReceiverOutput {
  readonly applied: boolean;
}

export class StartInterviewFromWebhookUseCase extends UseCase<
  StartFromWebhookInput,
  WebhookReceiverOutput
> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(
    input: StartFromWebhookInput,
  ): Promise<Result<WebhookReceiverOutput, ServiceError>> {
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
    const bound = interview.bindElevenLabsSession(input.elevenLabsSessionId);
    if (bound.isErr()) {
      return Result.Ok({ applied: false });
    }

    const afterBind = bound.unwrap();
    if (afterBind.status !== INTERVIEW_STATUS.SCHEDULED) {
      if (afterBind !== interview) {
        const saved = await this.interviews.save(afterBind);
        if (saved.isErr()) {
          return Result.Err(
            new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"),
          );
        }
      }
      return Result.Ok({ applied: false });
    }

    const started = afterBind.start(input.occurredAt);
    if (started.isErr()) {
      return Result.Ok({ applied: false });
    }

    const saved = await this.interviews.save(started.unwrap());
    if (saved.isErr()) {
      return Result.Err(
        new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"),
      );
    }

    return Result.Ok({ applied: true });
  }
}
