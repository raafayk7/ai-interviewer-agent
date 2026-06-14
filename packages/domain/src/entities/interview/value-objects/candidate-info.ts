import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export interface CandidateInfoProps {
  readonly fullName: string;
  readonly email: string;
  readonly headline: string; // e.g. "Senior Backend Engineer"
  readonly yearsOfExperience: number;
  readonly skills: ReadonlyArray<string>;
  readonly education: ReadonlyArray<string>;
  readonly rawText: string; // unparsed CV body
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class CandidateInfo {
  private constructor(
    readonly fullName: string,
    readonly email: string,
    readonly headline: string,
    readonly yearsOfExperience: number,
    readonly skills: ReadonlyArray<string>,
    readonly education: ReadonlyArray<string>,
    readonly rawText: string,
  ) {}

  static create(props: CandidateInfoProps): Result<CandidateInfo, InvalidInterviewInputError> {
    if (!props.fullName.trim()) {
      return Result.Err(new InvalidInterviewInputError("CandidateInfo.fullName must not be empty"));
    }
    if (!EMAIL.test(props.email)) {
      return Result.Err(new InvalidInterviewInputError(`CandidateInfo.email is invalid: ${props.email}`));
    }
    if (!Number.isFinite(props.yearsOfExperience) || props.yearsOfExperience < 0) {
      return Result.Err(new InvalidInterviewInputError("CandidateInfo.yearsOfExperience must be >= 0"));
    }
    return Result.Ok(
      new CandidateInfo(
        props.fullName,
        props.email,
        props.headline,
        props.yearsOfExperience,
        Object.freeze([...props.skills]),
        Object.freeze([...props.education]),
        props.rawText,
      ),
    );
  }

  serialize(): CandidateInfoProps {
    return {
      fullName: this.fullName,
      email: this.email,
      headline: this.headline,
      yearsOfExperience: this.yearsOfExperience,
      skills: this.skills,
      education: this.education,
      rawText: this.rawText,
    };
  }

  static fromSerialized(data: CandidateInfoProps): CandidateInfo {
    return new CandidateInfo(
      data.fullName,
      data.email,
      data.headline,
      data.yearsOfExperience,
      Object.freeze([...data.skills]),
      Object.freeze([...data.education]),
      data.rawText,
    );
  }
}
