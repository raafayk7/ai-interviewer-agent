import { buildApp } from "./app.js";

const PORT = Number(process.env["PORT"] ?? 3002);
const HOST = process.env["HOST"] ?? "0.0.0.0";

async function main() {
  const app = await buildApp();

  await app.listen({ port: PORT, host: HOST });
  console.log(`Server listening on ${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
