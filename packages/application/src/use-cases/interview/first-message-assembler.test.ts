import { CandidateInfo, JobDescription } from "@repo/domain";
import { describe, expect, it } from "vitest";
import { assembleInterviewFirstMessage } from "./first-message-assembler.js";

const makeJobDescription = (): JobDescription => {
  const result = JobDescription.create({
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Build APIs"],
    requirements: ["TypeScript"],
    rawText: "We need a backend engineer.",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeCandidateInfo = (fullName: string): CandidateInfo => {
  const result = CandidateInfo.create({
    fullName,
    email: "candidate@example.com",
    headline: "Engineer",
    yearsOfExperience: 6,
    skills: ["TypeScript"],
    education: ["B.Sc. CS"],
    rawText: "An experienced engineer.",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

describe("assembleInterviewFirstMessage", () => {
  it("includes the candidate's first name, the job title, and the company", () => {
    const message = assembleInterviewFirstMessage({
      candidateInfo: makeCandidateInfo("Jane Doe"),
      jobDescription: makeJobDescription(),
    });
    expect(message).toContain("Jane");
    expect(message).toContain("Senior Backend Engineer");
    expect(message).toContain("Acme Corp");
  });

  it("uses only the first token of a multi-word name", () => {
    const message = assembleInterviewFirstMessage({
      candidateInfo: makeCandidateInfo("Jane Margaret Doe"),
      jobDescription: makeJobDescription(),
    });
    expect(message).toContain("Hi Jane,");
    expect(message).not.toContain("Margaret");
  });

  it("title-cases an upper-cased name so the greeting does not shout", () => {
    const message = assembleInterviewFirstMessage({
      candidateInfo: makeCandidateInfo("RAAFAY SAEED KAZMI"),
      jobDescription: makeJobDescription(),
    });
    expect(message).toContain("Hi Raafay,");
    expect(message).not.toContain("RAAFAY");
  });
});
