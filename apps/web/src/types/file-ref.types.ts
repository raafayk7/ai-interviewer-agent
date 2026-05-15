import { z } from "zod";

export const FileRefSchema = z.object({
  key: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  originalFilename: z.string().min(1),
  uploadedAt: z.coerce.date(),
});
export type FileRef = z.infer<typeof FileRefSchema>;
