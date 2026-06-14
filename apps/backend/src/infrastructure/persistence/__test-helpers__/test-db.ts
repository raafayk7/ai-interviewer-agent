import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../schema/index.js";

const TEST_URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgres://test:test@localhost:54329/ai_interviewer_test";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_FOLDER = resolve(dirname(__filename), "../../../../drizzle");

let cachedClient: ReturnType<typeof postgres> | null = null;
let cachedDb: PostgresJsDatabase<typeof schema> | null = null;

export type TestDatabase = PostgresJsDatabase<typeof schema>;

export async function getTestDb(): Promise<TestDatabase> {
  if (cachedDb) return cachedDb;
  cachedClient = postgres(TEST_URL, { max: 4 });
  cachedDb = drizzle(cachedClient, { schema });
  await migrate(cachedDb, { migrationsFolder: MIGRATIONS_FOLDER });
  return cachedDb;
}

export async function truncateAll(db: TestDatabase): Promise<void> {
  await db.execute(
    sql.raw('TRUNCATE TABLE "reports", "interviews" RESTART IDENTITY CASCADE'),
  );
}

export async function closeTestDb(): Promise<void> {
  if (cachedClient) {
    await cachedClient.end({ timeout: 1 });
    cachedClient = null;
    cachedDb = null;
  }
}
