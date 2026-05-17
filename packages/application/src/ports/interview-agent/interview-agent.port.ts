import type { Result } from "@carbonteq/fp";
import type { AgentError } from "./interview-agent-error.js";

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentMessage {
  readonly role: AgentMessageRole;
  readonly content: string;
  /** Tool call tag for `role === "tool"` messages. */
  readonly toolName?: string;
}

export const END_INTERVIEW_REASON = {
  ALL_TOPICS_COVERED: "all_topics_covered",
  CANDIDATE_NOT_A_FIT: "candidate_not_a_fit",
  CANDIDATE_REQUESTED_END: "candidate_requested_end",
  CANDIDATE_SILENT: "candidate_silent",
  TIME_UP: "time_up",
} as const;

export type EndInterviewReason =
  (typeof END_INTERVIEW_REASON)[keyof typeof END_INTERVIEW_REASON];

export type AgentToolEvent =
  | {
      readonly kind: "next_question";
      readonly topicName: string;
      readonly question: string;
    }
  | {
      readonly kind: "score_answer";
      readonly topicName: string;
      readonly score: number;
      readonly justification: string;
    }
  | { readonly kind: "take_note"; readonly note: string }
  | { readonly kind: "end_interview"; readonly reason: EndInterviewReason };

export interface AgentTurnInput {
  readonly interviewId: string;
  readonly turnIndex: number;
  readonly systemPrompt: string;
  readonly conversationHistory: ReadonlyArray<AgentMessage>;
  /** When non-null, the adapter injects this string as a system-role message before the user turn. */
  readonly timeRemainingMessage: string | null;
  readonly abortSignal: AbortSignal;
}

export type AgentStopReason = "tool_call_complete" | "stop" | "abort" | "error";

export interface AgentTurnOutput {
  readonly text: string;
  readonly toolEvents: ReadonlyArray<AgentToolEvent>;
  readonly stopReason: AgentStopReason;
  /** Set when the model exposes token usage. */
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface IInterviewAgentService {
  /**
   * Run one agent turn. The adapter owns provider telemetry and does not mutate
   * domain aggregates; tool effects are returned for the use case to apply.
   */
  runTurn(input: AgentTurnInput): Promise<Result<AgentTurnOutput, AgentError>>;
}
