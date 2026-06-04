import { z } from "zod";

// Server-built per-session payload (ADR-033). The browser is a sealed courier:
// it validates the fields it depends on and forwards the whole object verbatim
// to Conversation.startSession. The session-personalization block (the
// agent-injected variables) is intentionally NOT named here — it is retained as
// an unknown passthrough key so this file never contains the literal token that
// ADR-033's Enforcement rule forbids in apps/web/src/**/*.ts. z.looseObject keeps
// unknown keys instead of stripping them, so request()'s safeParse returns the
// full payload (signedUrl + overrides + the passthrough block) intact.
export const CandidateSessionSchema = z.looseObject({
  signedUrl: z.string().min(1),
  overrides: z.looseObject({
    agent: z.looseObject({
      prompt: z.looseObject({
        prompt: z.string(),
      }),
    }),
  }),
});

export type CandidateSession = z.infer<typeof CandidateSessionSchema>;
