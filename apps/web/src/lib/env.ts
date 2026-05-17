import { z } from "zod";

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_WS_URL: z.string().regex(/^wss?:\/\//, "must start with ws:// or wss://"),
});

const parsed = PublicEnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
});

if (!parsed.success) {
  throw new Error(
    `Invalid frontend env vars:\n${parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n")}`,
  );
}

export const env = parsed.data;
