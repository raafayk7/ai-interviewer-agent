import { initOtel } from "./infrastructure/observability/otel.js";

const otel = initOtel();

const PORT = Number(process.env["PORT"] ?? 3002);
const HOST = process.env["HOST"] ?? "0.0.0.0";

async function main() {
  const { buildApp } = await import("./app.js");
  const app = await buildApp();

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`[main] received ${signal}, shutting down.`);

    try {
      await app.close();
    } finally {
      await otel.shutdown();
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: PORT, host: HOST });
  console.log(`Server listening on ${HOST}:${PORT}`);
}

main().catch(async (err) => {
  console.error("Failed to start server:", err);
  await otel.shutdown();
  process.exit(1);
});
