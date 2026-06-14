import { z } from "zod";
import { FileRefSchema } from "./file-ref.types";

export const JobDescriptionSchema = z.object({
  title: z.string(),
  company: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  rawText: z.string(),
});
export type JobDescription = z.infer<typeof JobDescriptionSchema>;

export const CandidateInfoSchema = z.object({
  fullName: z.string(),
  email: z.string(),
  headline: z.string(),
  yearsOfExperience: z.number().nonnegative(),
  skills: z.array(z.string()),
  education: z.array(z.string()),
  rawText: z.string(),
});
export type CandidateInfo = z.infer<typeof CandidateInfoSchema>;

export const UploadDocumentsResponseSchema = z.object({
  jdRef: FileRefSchema,
  cvRef: FileRefSchema,
});
export type UploadDocumentsResponse = z.infer<typeof UploadDocumentsResponseSchema>;

export const ExtractDocumentsResponseSchema = z.object({
  jobDescription: JobDescriptionSchema,
  candidateInfo: CandidateInfoSchema,
});
export type ExtractDocumentsResponse = z.infer<typeof ExtractDocumentsResponseSchema>;
