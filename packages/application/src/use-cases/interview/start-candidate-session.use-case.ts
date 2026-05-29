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
import { assembleInterviewSystemPrompt } from "./system-prompt-assembler.js";

export interface StartCandidateSessionInput {
  readonly interviewId: string;
  readonly agentId: string;
}

export interface StartCandidateSessionOutput {
  readonly signedUrl: string;
  readonly overrides: {
    readonly agent: {
      readonly prompt: { readonly prompt: string };
    };
  };
  readonly dynamicVariables: Readonly<Record<string, string>>;
}

export class StartCandidateSessionUseCase extends UseCase<
  StartCandidateSessionInput,
  StartCandidateSessionOutput
> {
  constructor(
    private readonly interviews: IInterviewRepository,
    private readonly agent: IConversationalAgentService,
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
    if (
      interview.status !== INTERVIEW_STATUS.SCHEDULED &&
      interview.status !== INTERVIEW_STATUS.IN_PROGRESS
    ) {
      return Result.Err(
        new InvalidInterviewInputError(
          `Interview ${interview.id} is not SCHEDULED or IN_PROGRESS`,
        ) as ServiceError,
      );
    }

    const planOrError = interview.interviewPlan.match({
      Some: (p) => Result.Ok(p),
      None: () => Result.Err(new InvalidInterviewInputError("Interview has no plan") as ServiceError),
    });
    if (planOrError.isErr()) {
      return planOrError;
    }
    const plan = planOrError.unwrap();

    const issued = await this.agent.issueSignedUrl({ agentId: input.agentId });
    if (issued.isErr()) {
      return Result.Err(issued.unwrapErr() as ServiceError);
    }
    const { signedUrl, conversationId } = issued.unwrap();

    const bound = interview.bindElevenLabsSession(conversationId);
    if (bound.isErr()) {
      return Result.Err(bound.unwrapErr() as ServiceError);
    }
    let next = bound.unwrap();

    // SCHEDULED → IN_PROGRESS transition — this is the only server-side moment
    // we control in the browser SDK flow. Skip when already IN_PROGRESS
    // (candidate refresh / reconnect re-issuing a single-use signed URL).
    if (next.status === INTERVIEW_STATUS.SCHEDULED) {
      const started = next.start(new Date());
      if (started.isErr()) {
        return Result.Err(started.unwrapErr() as ServiceError);
      }
      next = started.unwrap();
    }

    if (next !== interview) {
      const saved = await this.interviews.save(next);
      if (saved.isErr()) {
        return Result.Err(
          new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"),
        );
      }
    }

    const systemPrompt = assembleInterviewSystemPrompt({
      jobDescription: next.jobDescription,
      candidateInfo: next.candidateInfo,
      clientInstructions: next.clientInstructions,
      interviewPlan: plan,
    });

    return Result.Ok({
      signedUrl,
      overrides: {
        agent: {
          prompt: { prompt: systemPrompt },
        },
      },
      dynamicVariables: {
        candidate_name: next.candidateInfo.fullName,
        job_title: next.jobDescription.title,
        target_duration_minutes: String(plan.targetDurationMinutes),
        interview_id: next.id,
      },
    });
  }
}
