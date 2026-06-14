export type ServiceError =
  | { kind: "NETWORK"; message: string; cause?: unknown }
  | { kind: "RESPONSE_VALIDATION"; message: string; issues: unknown }
  | { kind: "AUTH"; status: 401 | 403; message: string }
  | { kind: "NOT_FOUND"; message: string }
  | { kind: "SERVER"; status: number; code?: string; message: string };
