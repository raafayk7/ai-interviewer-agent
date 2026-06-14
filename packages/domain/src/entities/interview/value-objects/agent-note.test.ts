import { describe, expect, it } from "vitest";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";
import { AgentNote } from "./agent-note.js";
import type { AgentNoteProps } from "./agent-note.js";

const baseProps = (overrides: Partial<AgentNoteProps> = {}): AgentNoteProps => ({
  note: "Candidate showed strong API design instincts.",
  recordedAtTurn: 2,
  recordedAt: new Date("2025-01-01T10:00:00Z"),
  ...overrides,
});

describe("AgentNote", () => {
  describe("create()", () => {
    it("creates a valid note", () => {
      const result = AgentNote.create(baseProps());
      expect(result.isOk()).toBe(true);
      const note = result.unwrap();
      expect(note.note).toBe("Candidate showed strong API design instincts.");
      expect(note.recordedAtTurn).toBe(2);
    });

    it("rejects empty note", () => {
      const result = AgentNote.create(baseProps({ note: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects whitespace-only note", () => {
      const result = AgentNote.create(baseProps({ note: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects negative recordedAtTurn", () => {
      const result = AgentNote.create(baseProps({ recordedAtTurn: -1 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("rejects fractional recordedAtTurn", () => {
      const result = AgentNote.create(baseProps({ recordedAtTurn: 1.5 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });
  });

  describe("serialize() / fromSerialized()", () => {
    it("round-trips without data loss", () => {
      const props = baseProps();
      const result = AgentNote.create(props);
      expect(result.isOk()).toBe(true);
      const serialized = result.unwrap().serialize();
      const restored = AgentNote.fromSerialized(serialized);

      expect(restored.note).toBe(props.note);
      expect(restored.recordedAtTurn).toBe(props.recordedAtTurn);
      expect(restored.recordedAt).toEqual(props.recordedAt);
    });
  });
});
