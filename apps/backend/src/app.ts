import Fastify from "fastify";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  // Register routes here
  // await app.register(import("./presentation/routes/index.js"));

  return app;
}
