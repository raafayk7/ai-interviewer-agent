import { Result } from "@carbonteq/fp";
import {
  InterviewNotFoundError,
  type InterviewSerialized,
} from "@repo/domain";

export function assertRecruiterOwnsInterview(
  interview: InterviewSerialized,
  recruiterId: string,
): Result<InterviewSerialized, InterviewNotFoundError> {
  if (interview.recruiterId !== recruiterId) {
    return Result.Err(new InterviewNotFoundError(interview.id));
  }

  return Result.Ok(interview);
}
