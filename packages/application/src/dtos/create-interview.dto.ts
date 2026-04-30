import { z } from "zod";
import { Result } from "@carbonteq/fp";
import type { InterviewStatus } from "@repo/domain";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

const FileRefSchema = z.object({
  key: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  originalFilename: z.string().min(1),
  uploadedAt: z.date(),
});

const JobDescriptionSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  rawText: z.string().min(1),
});

const CandidateInfoSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  headline: z.string(),
  yearsOfExperience: z.number().nonnegative(),
  skills: z.array(z.string()),
  education: z.array(z.string()),
  rawText: z.string().min(1),
});

export const CreateInterviewInputSchema = z.object({
  recruiterId: z.string().min(1),
  jobDescription: JobDescriptionSchema,
  candidateInfo: CandidateInfoSchema,
  clientInstructions: z.string(),
  scheduledAt: z.date(),
  jdFileRef: FileRefSchema,
  cvFileRef: FileRefSchema,
});

export type CreateInterviewInput = z.infer<typeof CreateInterviewInputSchema>;

export class CreateInterviewInputDto extends BaseDto<CreateInterviewInput> {
  static parse(raw: unknown): Result<CreateInterviewInputDto, DtoValidationError> {
    return BaseDto.validate(CreateInterviewInputSchema, raw).map((v) => new CreateInterviewInputDto(v));
  }
}

export interface CreateInterviewOutput {
  readonly interviewId: string;
  readonly status: InterviewStatus;
  readonly scheduledAt: Date;
}
