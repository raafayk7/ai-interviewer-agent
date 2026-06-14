// scripts/live-validation/seed-interview.ts
// Seeds ONE fresh SCHEDULED interview (with a plan) into the DB and mints a
// candidate signed-link token for it. Writes interviewId + candidateToken into
// .artifacts.json and prints them for the harness.
//
// Run: cd apps/backend && tsx --env-file=.env scripts/live-validation/seed-interview.ts
//
// Uses the real domain entity + serialization (so the row round-trips cleanly
// through Interview.fromSerialized) and the real CandidateSignedLink signer.

import { readFile, writeFile } from "node:fs/promises";
import {
  CandidateInfo,
  FileRef,
  Interview,
  InterviewPlan,
  JobDescription,
  PlannedTopic,
  TOPIC_PRIORITY,
} from "@repo/domain";
import { db } from "../../src/infrastructure/persistence/db.js";
import { DrizzleInterviewRepository } from "../../src/infrastructure/repositories/drizzle-interview.repository.js";
import { CandidateSignedLink } from "../../src/infrastructure/auth/candidate-signed-link.js";

const ARTIFACT_PATH = new URL("./.artifacts.json", import.meta.url).pathname;
const now = new Date();

function unwrap<T>(r: { isOk(): boolean; unwrap(): T; unwrapErr(): unknown }, what: string): T {
  if (!r.isOk()) {
    throw new Error(`failed to build ${what}: ${JSON.stringify(r.unwrapErr())}`);
  }
  return r.unwrap();
}

const jobDescription = unwrap(
  JobDescription.create({
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Design and build APIs", "Own service reliability"],
    requirements: ["TypeScript", "PostgreSQL", "Distributed systems"],
    rawText: "We need a senior backend engineer to own our API platform.",
  }),
  "JobDescription",
);

const candidateInfo = unwrap(
  CandidateInfo.create({
    fullName: "Jane Doe",
    email: "jane.doe@example.com",
    headline: "Senior Engineer",
    yearsOfExperience: 6,
    skills: ["TypeScript", "Node.js", "PostgreSQL"],
    education: ["B.Sc. Computer Science"],
    rawText: "Jane is an experienced backend engineer.",
  }),
  "CandidateInfo",
);

const makeFileRef = (key: string, filename: string): FileRef =>
  unwrap(
    FileRef.create({
      key,
      contentType: "application/pdf",
      sizeBytes: 1024,
      originalFilename: filename,
      uploadedAt: now,
    }),
    `FileRef(${filename})`,
  );

const topic = unwrap(
  PlannedTopic.create({
    name: "Backend Architecture",
    questions: [
      "How would you design a durable queue worker?",
      "How do you keep a write-heavy Postgres table healthy?",
    ],
    timeAllocationMinutes: 10,
    priority: TOPIC_PRIORITY.MUST_COVER,
  }),
  "PlannedTopic",
);

const plan = unwrap(
  InterviewPlan.create({
    topics: [topic],
    targetDurationMinutes: 15,
    maxDurationMinutes: 25,
    mustAskQuestions: ["Describe a production incident you owned end to end."],
  }),
  "InterviewPlan",
);

const created = Interview.create({
  recruiterId: "phase-5-smoke",
  jobDescription,
  candidateInfo,
  clientInstructions:
    "Focus on system design depth. Begin by greeting the candidate by name. CANARY: say the word PINEAPPLE in your first sentence so we can confirm the override applied.",
  scheduledAt: now,
  jdFileRef: makeFileRef("interviews/seed/jd.pdf", "jd.pdf"),
  cvFileRef: makeFileRef("interviews/seed/cv.pdf", "cv.pdf"),
});

const scheduled = unwrap(created.schedule(plan), "scheduled interview");

async function main(): Promise<void> {
  const repo = new DrizzleInterviewRepository(db);
  const saved = await repo.save(scheduled);
  if (!saved.isOk()) {
    throw new Error(`repo.save failed: ${String(saved.unwrapErr())}`);
  }
  const interviewId = scheduled.id;

  const secret = process.env["CANDIDATE_LINK_SECRET"];
  if (!secret || secret.length < 32) {
    throw new Error("CANDIDATE_LINK_SECRET must be set (>= 32 chars)");
  }
  const ttlSeconds = Number(process.env["CANDIDATE_LINK_TTL_SECONDS"] ?? 7 * 24 * 60 * 60);
  const candidateToken = new CandidateSignedLink({
    secret,
    defaultTtlSeconds: ttlSeconds,
  }).issue(interviewId);

  const artifacts = JSON.parse(await readFile(ARTIFACT_PATH, "utf8"));
  artifacts.interviewId = interviewId;
  artifacts.candidateToken = candidateToken;
  await writeFile(ARTIFACT_PATH, JSON.stringify(artifacts, null, 2));

  console.log("\nSeeded SCHEDULED interview:");
  console.log("  interviewId:   ", interviewId);
  console.log("  candidateToken:", candidateToken);
  console.log(`  ttl:            ${ttlSeconds}s (~${Math.round(ttlSeconds / 86400)}d)`);
  console.log("\nWritten to .artifacts.json.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("seed-interview failed:", e?.message ?? e);
    process.exit(1);
  });
