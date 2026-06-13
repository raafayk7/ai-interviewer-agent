export const INTERVIEW_STATUS = {
  CREATED: "CREATED",
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  EVALUATED: "EVALUATED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
} as const;

export type InterviewStatus = (typeof INTERVIEW_STATUS)[keyof typeof INTERVIEW_STATUS];

/**
 * Allowed transitions (closed set per §5.4):
 *   CREATED      → SCHEDULED
 *   SCHEDULED    → IN_PROGRESS
 *   IN_PROGRESS  → COMPLETED | CANCELLED | FAILED
 *   COMPLETED    → EVALUATED
 *   EVALUATED    → (terminal)
 *   CANCELLED    → (terminal)
 *   FAILED       → (terminal)
 */
const ALLOWED: Readonly<Record<InterviewStatus, ReadonlyArray<InterviewStatus>>> = {
  CREATED: ["SCHEDULED"],
  SCHEDULED: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED", "FAILED"],
  COMPLETED: ["EVALUATED"],
  EVALUATED: [],
  CANCELLED: [],
  FAILED: [],
};

export const InterviewStatusPolicy = {
  canTransition(from: InterviewStatus, to: InterviewStatus): boolean {
    return ALLOWED[from].includes(to);
  },
  isTerminal(status: InterviewStatus): boolean {
    return ALLOWED[status].length === 0;
  },
} as const;
