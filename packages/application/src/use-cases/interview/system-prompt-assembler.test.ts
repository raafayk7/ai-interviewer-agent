import {
  CandidateInfo,
  InterviewPlan,
  JobDescription,
  PlannedTopic,
  TOPIC_PRIORITY,
} from "@repo/domain";
import { describe, expect, it } from "vitest";
import { assembleInterviewSystemPrompt } from "./system-prompt-assembler.js";

const makeJobDescription = (): JobDescription => {
  const result = JobDescription.create({
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Build APIs", "Own reliability"],
    requirements: ["TypeScript", "Postgres"],
    rawText: "We need a backend engineer.",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeCandidateInfo = (): CandidateInfo => {
  const result = CandidateInfo.create({
    fullName: "Jane Doe",
    email: "jane.doe@example.com",
    headline: "Senior Engineer",
    yearsOfExperience: 6,
    skills: ["TypeScript", "Kafka"],
    education: ["B.Sc. CS"],
    rawText: "Jane is an experienced engineer.",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makePlan = (
  mustAskQuestions: ReadonlyArray<string> = ["Describe a production incident."],
): InterviewPlan => {
  const backendTopic = PlannedTopic.create({
    name: "Backend Architecture",
    questions: ["How would you design a queue worker?"],
    timeAllocationMinutes: 10,
    priority: TOPIC_PRIORITY.MUST_COVER,
  });
  const reliabilityTopic = PlannedTopic.create({
    name: "Reliability",
    questions: ["How do you debug latency?"],
    timeAllocationMinutes: 5,
    priority: TOPIC_PRIORITY.IF_TIME_PERMITS,
  });
  expect(backendTopic.isOk()).toBe(true);
  expect(reliabilityTopic.isOk()).toBe(true);

  const plan = InterviewPlan.create({
    topics: [backendTopic.unwrap(), reliabilityTopic.unwrap()],
    targetDurationMinutes: 15,
    maxDurationMinutes: 25,
    mustAskQuestions,
  });
  expect(plan.isOk()).toBe(true);
  return plan.unwrap();
};

describe("assembleInterviewSystemPrompt", () => {
  it("includes interview context, plan details, durations, and tool names", () => {
    const prompt = assembleInterviewSystemPrompt({
      jobDescription: makeJobDescription(),
      candidateInfo: makeCandidateInfo(),
      clientInstructions: "Focus on system design.",
      interviewPlan: makePlan(),
    });

    expect(prompt).toContain("Senior Backend Engineer");
    expect(prompt).toContain("Acme Corp");
    expect(prompt).toContain("Jane Doe");
    expect(prompt).toContain("Backend Architecture");
    expect(prompt).toContain("Reliability");
    expect(prompt).toContain("Describe a production incident.");
    expect(prompt).toContain("15 minutes");
    expect(prompt).toContain("25 minutes");
    expect(prompt).toContain("next_question");
    expect(prompt).toContain("score_answer");
    expect(prompt).toContain("take_note");
    expect(prompt).toContain("end_interview");
  });

  it("uses (none) for empty client instructions", () => {
    const prompt = assembleInterviewSystemPrompt({
      jobDescription: makeJobDescription(),
      candidateInfo: makeCandidateInfo(),
      clientInstructions: "   ",
      interviewPlan: makePlan(),
    });

    expect(prompt).toContain("Client instructions:\n  (none)");
  });

  it("uses (none) for empty must-ask questions", () => {
    const prompt = assembleInterviewSystemPrompt({
      jobDescription: makeJobDescription(),
      candidateInfo: makeCandidateInfo(),
      clientInstructions: "Focus on system design.",
      interviewPlan: makePlan([]),
    });

    expect(prompt).toContain("Must-ask questions:\n  (none)");
  });
});
