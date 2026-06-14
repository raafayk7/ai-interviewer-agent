import { describe, expect, it } from "vitest";
import { ConductInterviewInputDto } from "./conduct-interview.dto.js";

describe("ConductInterviewInputDto", () => {
  it("parses a valid interview id", () => {
    const result = ConductInterviewInputDto.parse({ interviewId: "interview-001" });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().value).toEqual({ interviewId: "interview-001" });
  });

  it("rejects an empty interview id", () => {
    const result = ConductInterviewInputDto.parse({ interviewId: "" });

    expect(result.isErr()).toBe(true);
  });

  it("rejects non-object input", () => {
    const result = ConductInterviewInputDto.parse("interview-001");

    expect(result.isErr()).toBe(true);
  });
});
