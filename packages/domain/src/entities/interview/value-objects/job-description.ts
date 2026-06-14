import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export interface JobDescriptionProps {
  readonly title: string;
  readonly company: string;
  readonly responsibilities: ReadonlyArray<string>;
  readonly requirements: ReadonlyArray<string>;
  readonly rawText: string; // unparsed JD body, kept for traceability
}

export class JobDescription {
  private constructor(
    readonly title: string,
    readonly company: string,
    readonly responsibilities: ReadonlyArray<string>,
    readonly requirements: ReadonlyArray<string>,
    readonly rawText: string,
  ) {}

  static create(props: JobDescriptionProps): Result<JobDescription, InvalidInterviewInputError> {
    if (!props.title.trim()) {
      return Result.Err(new InvalidInterviewInputError("JobDescription.title must not be empty"));
    }
    if (!props.company.trim()) {
      return Result.Err(new InvalidInterviewInputError("JobDescription.company must not be empty"));
    }
    if (!props.rawText.trim()) {
      return Result.Err(new InvalidInterviewInputError("JobDescription.rawText must not be empty"));
    }
    return Result.Ok(
      new JobDescription(
        props.title,
        props.company,
        Object.freeze([...props.responsibilities]),
        Object.freeze([...props.requirements]),
        props.rawText,
      ),
    );
  }

  serialize(): JobDescriptionProps {
    return {
      title: this.title,
      company: this.company,
      responsibilities: this.responsibilities,
      requirements: this.requirements,
      rawText: this.rawText,
    };
  }

  static fromSerialized(data: JobDescriptionProps): JobDescription {
    return new JobDescription(
      data.title,
      data.company,
      Object.freeze([...data.responsibilities]),
      Object.freeze([...data.requirements]),
      data.rawText,
    );
  }
}
