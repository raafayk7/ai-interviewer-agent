// scripts/live-validation/seed-interview.mjs
// Inserts a SCHEDULED interview with a minimal but valid plan, mints a
// candidate signed-link token bound to it, writes both to the artifacts file.

import postgres from "postgres";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

const ARTIFACT_PATH = new URL("./.artifacts.json", import.meta.url).pathname;

const sql = postgres(process.env.DATABASE_URL);
const secret = process.env.CANDIDATE_LINK_SECRET;
if (!secret) { console.error("CANDIDATE_LINK_SECRET missing"); process.exit(2); }

const recruiterId = (await sql`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`)[0]?.id;
if (!recruiterId) { console.error("no recruiter user found in users table"); process.exit(2); }
console.log("recruiter:", recruiterId);

const interviewId = randomUUID();
const now = new Date();
const scheduledAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 min from now
const jobDescription = {
  title: "Senior Backend Engineer",
  summary: "Backend engineer for a Node.js + Postgres SaaS product.",
  requirements: ["5+ years TypeScript", "Postgres", "Distributed systems"],
  responsibilities: ["Design APIs", "Own a feature area end-to-end"],
};
const candidateInfo = {
  fullName: "Test Candidate",
  email: "test@example.invalid",
  experienceYears: 6,
  skills: ["TypeScript", "Postgres", "Fastify"],
};
const interviewPlan = {
  topics: [
    { name: "Background", questions: ["Tell me about yourself."], timeAllocationMinutes: 3, priority: "must_cover" },
    { name: "TypeScript depth", questions: ["Walk me through a recent challenging TS project."], timeAllocationMinutes: 6, priority: "must_cover" },
    { name: "Wrap-up", questions: ["Any questions for us?"], timeAllocationMinutes: 2, priority: "if_time_permits" },
  ],
  targetDurationMinutes: 15,
  maxDurationMinutes: 25,
  mustAskQuestions: ["Tell me about yourself."],
};
const fileRef = { storageKey: "live-validation/placeholder", contentType: "application/pdf", uploadedAt: now.toISOString(), sizeBytes: 1 };

await sql`
  INSERT INTO interviews (
    id, recruiter_id, status,
    job_description, candidate_info, client_instructions, interview_plan,
    transcript, jd_file_ref, cv_file_ref,
    scheduled_at, created_at, updated_at,
    notes, internal_scores
  ) VALUES (
    ${interviewId}, ${recruiterId}, 'SCHEDULED',
    ${sql.json(jobDescription)}, ${sql.json(candidateInfo)},
    ${"Focus on backend engineering depth; keep it conversational."},
    ${sql.json(interviewPlan)},
    ${sql.json([])}, ${sql.json(fileRef)}, ${sql.json(fileRef)},
    ${scheduledAt}, ${now}, ${now},
    ${sql.json([])}, ${sql.json([])}
  )
`;
console.log("interview inserted:", interviewId);

// Mint candidate signed link token — matches CandidateSignedLink.issue():
//   base64url("<interviewId>|<expSeconds>").<base64url hmac-sha256 of payload>
const TTL_SECONDS = 60 * 60; // 1 hour
const expSec = Math.floor(Date.now() / 1000) + TTL_SECONDS;
const payload = `${interviewId}|${expSec}`;
const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
const sig = createHmac("sha256", secret).update(payload).digest().toString("base64url");
const token = `${payloadB64}.${sig}`;
console.log("candidate token issued (ttl 1h)");

const artifacts = JSON.parse(await fs.readFile(ARTIFACT_PATH, "utf8"));
artifacts.interviewId = interviewId;
artifacts.candidateToken = token;
await fs.writeFile(ARTIFACT_PATH, JSON.stringify(artifacts, null, 2));
console.log("artifact updated");

await sql.end();
