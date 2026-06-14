import { Result } from "@carbonteq/fp";
import { LangfuseClient } from "@langfuse/client";

import { PromptFetchError } from "./errors.js";
import { renderTemplate } from "./render-template.js";

export interface LangfusePromptHandle {
  compile(variables: Record<string, string>): string;
  toJSON(): unknown;
  readonly isFallback: boolean;
}

export interface FetchedPrompt {
  readonly handle: LangfusePromptHandle;
  readonly isFallback: boolean;
}

export interface ILangfusePromptClient {
  getText(key: string, fallback: string): Promise<Result<FetchedPrompt, PromptFetchError>>;
}

export interface LangfusePromptClientConfig {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly baseUrl: string;
}

const messageFromUnknown = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err);
};

export class LangfusePromptClient implements ILangfusePromptClient {
  private readonly client: LangfuseClient;

  constructor(config: LangfusePromptClientConfig) {
    this.client = new LangfuseClient({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.baseUrl,
    });
  }

  async getText(
    key: string,
    fallback: string,
  ): Promise<Result<FetchedPrompt, PromptFetchError>> {
    return Result.tryAsyncCatch(
      async () => {
        const handle = await this.client.prompt.get(key, {
          type: "text",
          fallback,
        });

        return {
          handle,
          isFallback: handle.isFallback,
        };
      },
      (err) => new PromptFetchError(messageFromUnknown(err), key, err),
    ).toPromise();
  }
}

export const langfusePromptClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Result<LangfusePromptClient, PromptFetchError> => {
  const publicKey = env["LANGFUSE_PUBLIC_KEY"];
  const secretKey = env["LANGFUSE_SECRET_KEY"];
  const baseUrl = env["LANGFUSE_BASE_URL"];

  if (!publicKey || !secretKey || !baseUrl) {
    return Result.Err(
      new PromptFetchError(
        "LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL must be set",
        "<bootstrap>",
      ),
    );
  }

  return Result.tryCatch(
    () => new LangfusePromptClient({ publicKey, secretKey, baseUrl }),
    (err) => new PromptFetchError(messageFromUnknown(err), "<bootstrap>", err),
  );
};

export class NullLangfusePromptClient implements ILangfusePromptClient {
  async getText(
    key: string,
    fallback: string,
  ): Promise<Result<FetchedPrompt, PromptFetchError>> {
    const handle: LangfusePromptHandle = {
      isFallback: true,
      compile: (variables) => renderTemplate(fallback, variables),
      toJSON: () => ({ kind: "null-langfuse-prompt-client", key }),
    };

    return Result.Ok({ handle, isFallback: true });
  }
}
