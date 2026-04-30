import type { Option, Result } from "@carbonteq/fp";
import type { Interview, InterviewId, RecruiterId } from "./interview.entity.js";

export interface IInterviewRepository {
  /** Insert or update. Returns the persisted entity. */
  save(interview: Interview): Promise<Result<Interview, Error>>;

  findById(id: InterviewId): Promise<Result<Option<Interview>, Error>>;

  listByRecruiter(recruiterId: RecruiterId): Promise<Result<ReadonlyArray<Interview>, Error>>;

  delete(id: InterviewId): Promise<Result<void, Error>>;
}
