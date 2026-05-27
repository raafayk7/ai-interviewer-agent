import { Result } from "@carbonteq/fp";
import {
  INTERVIEW_STATUS,
  InterviewNotFoundError,
  InvalidInterviewInputError,
  type IInterviewRepository,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";
import type { IConversationalAgentService } from "../../ports/conversational-agent/index.js";
import type { IConversationCorrelationTokenIssuer } from "../../ports/conversation-correlation-token/index.js";

export interface StartCandidateSessionInput {
  readonly interviewId: string;
  readonly agentId: string;
}

export interface StartCandidateSessionOutput {
  readonly signedUrl: string;
  readonly sessionToken: string;
}

export class StartCandidateSessionUseCase extends UseCase<
  StartCandidateSessionInput,
  StartCandidateSessionOutput
> {
  constructor(
    private readonly interviews: IInterviewRepository,
    private readonly agent: IConversationalAgentService,
    private readonly tokens: IConversationCorrelationTokenIssuer,
  ) {
    super();
  }

  async execute(
    input: StartCandidateSessionInput,
  ): Promise<Result<StartCandidateSessionOutput, ServiceError>> {
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
    if (interview.status !== INTERVIEW_STATUS.SCHEDULED) {
      return Result.Err(
        new InvalidInterviewInputError(`Interview ${interview.id} is not SCHEDULED`) as ServiceError,
      );
    }

    const hasPlan = interview.interviewPlan.match({
      Some: () => true,
      None: () => false,
    });
    if (!hasPlan) {
      return Result.Err(new InvalidInterviewInputError("Interview has no plan") as ServiceError);
    }

    const issued = await this.agent.issueSignedUrl({ agentId: input.agentId });
    if (issued.isErr()) {
      return Result.Err(issued.unwrapErr() as ServiceError);
    }

    return Result.Ok({
      signedUrl: issued.unwrap().signedUrl,
      sessionToken: this.tokens.issue(interview.id),
    });
  }
}
