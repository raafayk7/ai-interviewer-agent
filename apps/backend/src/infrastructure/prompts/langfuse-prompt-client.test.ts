import { describe, expect, it } from "vitest";

import { PromptFetchError } from "./errors.js";
import {
  langfusePromptClientFromEnv,
  LangfusePromptClient,
  NullLangfusePromptClient,
} from "./langfuse-prompt-client.js";

describe("langfusePromptClientFromEnv", () => {
  it("returns a PromptFetchError when required Langfuse env is missing", () => {
    const result = langfusePromptClientFromEnv({});

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(PromptFetchError);
    expect(result.unwrapErr().promptKey).toBe("<bootstrap>");
  });

  it("builds a Langfuse prompt client from explicit env values", () => {
    const result = langfusePromptClientFromEnv({
      LANGFUSE_PUBLIC_KEY: "pk-test",
      LANGFUSE_SECRET_KEY: "sk-test",
      LANGFUSE_BASE_URL: "https://cloud.langfuse.com",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeInstanceOf(LangfusePromptClient);
  });
});

describe("NullLangfusePromptClient", () => {
  it("returns a fallback prompt handle that compiles locally", async () => {
    const client = new NullLangfusePromptClient();
    const result = await client.getText("test-prompt", "Hello {{name}}");

    expect(result.isOk()).toBe(true);

    const fetched = result.unwrap();
    expect(fetched.isFallback).toBe(true);
    expect(fetched.handle.isFallback).toBe(true);
    expect(fetched.handle.compile({ name: "Ada" })).toBe("Hello Ada");
  });
});
