import { z } from "zod";

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
  // "true" routes client calls through the same-origin /be proxy (next.config
  // rewrite); anything else calls the backend directly. Default direct.
  NEXT_PUBLIC_USE_BE_PROXY: z.enum(["true", "false"]).optional().default("false"),
});

const parsed = PublicEnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_USE_BE_PROXY: process.env.NEXT_PUBLIC_USE_BE_PROXY,
});

if (!parsed.success) {
  throw new Error(
    `Invalid frontend env vars:\n${parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n")}`,
  );
}

export const env = parsed.data;
