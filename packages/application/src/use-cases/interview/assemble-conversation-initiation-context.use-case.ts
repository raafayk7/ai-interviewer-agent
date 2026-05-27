import { Result, type Option } from "@carbonteq/fp";
import {
  INTERVIEW_STATUS,
  InterviewNotFoundError,
  InvalidInterviewInputError,
  type IInterviewRepository,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";
import type { IConversationCorrelationTokenIssuer } from "../../ports/conversation-correlation-token/index.js";
import { assembleInterviewSystemPrompt } from "./system-prompt-assembler.js";

export interface AssembleInitiationInput {
  readonly correlationToken: string;
  readonly conversationId: Option<string>;
}

export interface AssembleInitiationOutput {
  readonly interviewId: string;
  readonly systemPrompt: string;
  readonly firstMessage?: string;
  readonly dynamicVariables: Readonly<Record<string, string>>;
}

export class AssembleConversationInitiationContextUseCase extends UseCase<
  AssembleInitiationInput,
  AssembleInitiationOutput
> {
  constructor(
    private readonly interviews: IInterviewRepository,
    private readonly tokens: IConversationCorrelationTokenIssuer,
  ) {
    super();
  }

  async execute(
    input: AssembleInitiationInput,
  ): Promise<Result<AssembleInitiationOutput, ServiceError>> {
    const verified = this.tokens.verify(input.correlationToken);
    if (verified.isErr()) {
      return Result.Err(verified.unwrapErr() as ServiceError);
    }

    const { interviewId } = verified.unwrap();
    const found = await this.interviews.findById(interviewId);
    if (found.isErr()) {
      return Result.Err(
        new ServiceUnknownError(found.unwrapErr().message, "InterviewRepository.findById"),
      );
    }

    const interviewOrError = found.unwrap().match({
      Some: (interview) => Result.Ok(interview),
      None: () => Result.Err(new InterviewNotFoundError(interviewId) as ServiceError),
    });
    if (interviewOrError.isErr()) {
      return interviewOrError;
    }

    const interview = interviewOrError.unwrap();
    if (
      interview.status !== INTERVIEW_STATUS.SCHEDULED &&
      interview.status !== INTERVIEW_STATUS.IN_PROGRESS
    ) {
      return Result.Err(
        new InvalidInterviewInputError(
          `Interview ${interview.id} cannot initiate from status ${interview.status}`,
        ) as ServiceError,
      );
    }

    const planOrError = interview.interviewPlan.match({
      Some: (plan) => Result.Ok(plan),
      None: () => Result.Err(new InvalidInterviewInputError("Interview has no plan") as ServiceError),
    });
    if (planOrError.isErr()) {
      return planOrError;
    }

    const bound = input.conversationId.match({
      Some: (conversationId) => interview.bindElevenLabsSession(conversationId),
      None: () => Result.Ok(interview),
    });
    if (bound.isErr()) {
      return Result.Err(bound.unwrapErr() as ServiceError);
    }

    const next = bound.unwrap();
    if (next !== interview) {
      const saved = await this.interviews.save(next);
      if (saved.isErr()) {
        return Result.Err(
          new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"),
        );
      }
    }

    const plan = planOrError.unwrap();
    return Result.Ok({
      interviewId: next.id,
      systemPrompt: assembleInterviewSystemPrompt({
        jobDescription: next.jobDescription,
        candidateInfo: next.candidateInfo,
        clientInstructions: next.clientInstructions,
        interviewPlan: plan,
      }),
      dynamicVariables: {
        candidate_name: next.candidateInfo.fullName,
        job_title: next.jobDescription.title,
        target_duration_minutes: String(plan.targetDurationMinutes),
        interview_id: next.id,
      },
    });
  }
}
