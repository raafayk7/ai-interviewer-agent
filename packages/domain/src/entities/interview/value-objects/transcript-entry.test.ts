import { describe, expect, it } from "vitest";
import { TranscriptEntry, SPEAKER } from "./transcript-entry.js";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";
import type { TranscriptEntryProps } from "./transcript-entry.js";

const baseProps = (overrides: Partial<TranscriptEntryProps> = {}): TranscriptEntryProps => ({
  speaker: SPEAKER.AGENT,
  text: "Tell me about your experience with distributed systems.",
  timestamp: new Date("2025-01-01T10:00:00Z"),
  ...overrides,
});

describe("TranscriptEntry", () => {
  describe("create()", () => {
    it("creates a valid TranscriptEntry for agent speaker", () => {
      const result = TranscriptEntry.create(baseProps({ speaker: SPEAKER.AGENT }));
      expect(result.isOk()).toBe(true);
      const entry = result.unwrap();
      expect(entry.speaker).toBe(SPEAKER.AGENT);
    });

    it("creates a valid TranscriptEntry for candidate speaker", () => {
      const result = TranscriptEntry.create(
        baseProps({ speaker: SPEAKER.CANDIDATE, text: "I have 5 years of experience with Kafka and Redis." }),
      );
      expect(result.isOk()).toBe(true);
      const entry = result.unwrap();
      expect(entry.speaker).toBe(SPEAKER.CANDIDATE);
    });

    it("rejects empty text", () => {
      const result = TranscriptEntry.create(baseProps({ text: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects whitespace-only text", () => {
      const result = TranscriptEntry.create(baseProps({ text: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });
  });

  describe("serialize() / fromSerialized()", () => {
    it("round-trips without data loss", () => {
      const props = baseProps();
      const result = TranscriptEntry.create(props);
      expect(result.isOk()).toBe(true);
      const entry = result.unwrap();
      const serialized = entry.serialize();
      const restored = TranscriptEntry.fromSerialized(serialized);
      expect(restored.speaker).toBe(props.speaker);
      expect(restored.text).toBe(props.text);
      expect(restored.timestamp).toEqual(props.timestamp);
    });

    it("fromSerialized preserves candidate speaker", () => {
      const props = baseProps({ speaker: SPEAKER.CANDIDATE, text: "My answer is..." });
      const restored = TranscriptEntry.fromSerialized(props);
      expect(restored.speaker).toBe(SPEAKER.CANDIDATE);
      expect(restored.text).toBe("My answer is...");
    });
  });
});
