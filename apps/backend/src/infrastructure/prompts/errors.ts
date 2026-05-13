export class PromptFetchError extends Error {
  readonly code = "PROMPT_FETCH_FAILED";

  constructor(
    message: string,
    readonly promptKey: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PromptFetchError";
  }
}
