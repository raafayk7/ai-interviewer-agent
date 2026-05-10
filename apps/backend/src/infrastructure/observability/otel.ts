import { isDefaultExportSpan, LangfuseSpanProcessor } from "@langfuse/otel";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { NodeSDK } from "@opentelemetry/sdk-node";

export interface OtelHandle {
  shutdown(): Promise<void>;
}

export function initOtel(env: NodeJS.ProcessEnv = process.env): OtelHandle {
  const publicKey = env["LANGFUSE_PUBLIC_KEY"];
  const secretKey = env["LANGFUSE_SECRET_KEY"];
  const baseUrl = env["LANGFUSE_BASE_URL"];

  if (!publicKey || !secretKey || !baseUrl) {
    console.warn(
      "[otel] Langfuse env vars missing; OpenTelemetry bootstrap skipped.",
    );
    return { shutdown: async () => undefined };
  }

  const sdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey,
        secretKey,
        baseUrl,
        shouldExportSpan: ({ otelSpan }) =>
          otelSpan.name.startsWith("interview.") || isDefaultExportSpan(otelSpan),
      }),
    ],
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  let isShutdown = false;

  return {
    async shutdown() {
      if (isShutdown) return;

      isShutdown = true;
      await sdk.shutdown();
    },
  };
}
