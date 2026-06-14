import { describe, expect, it } from "vitest";
import { FileRef, InvalidFileRefError } from "./file-ref.js";
import type { FileRefProps } from "./file-ref.js";

const baseProps = (overrides: Partial<FileRefProps> = {}): FileRefProps => ({
  key: "interviews/abc/jd.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
  originalFilename: "job-description.pdf",
  uploadedAt: new Date("2025-01-01T00:00:00Z"),
  ...overrides,
});

describe("FileRef", () => {
  describe("create()", () => {
    it("creates a valid FileRef from complete valid props", () => {
      const result = FileRef.create(baseProps());
      expect(result.isOk()).toBe(true);
      const ref = result.unwrap();
      expect(ref.key).toBe("interviews/abc/jd.pdf");
      expect(ref.contentType).toBe("application/pdf");
      expect(ref.sizeBytes).toBe(1024);
      expect(ref.originalFilename).toBe("job-description.pdf");
    });

    it("rejects empty key", () => {
      const result = FileRef.create(baseProps({ key: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidFileRefError);
    });

    it("rejects whitespace-only key", () => {
      const result = FileRef.create(baseProps({ key: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidFileRefError);
    });

    it("rejects empty contentType", () => {
      const result = FileRef.create(baseProps({ contentType: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidFileRefError);
    });

    it("rejects whitespace-only contentType", () => {
      const result = FileRef.create(baseProps({ contentType: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidFileRefError);
    });

    it("rejects negative sizeBytes", () => {
      const result = FileRef.create(baseProps({ sizeBytes: -1 }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidFileRefError);
    });

    it("accepts zero sizeBytes (empty file is valid)", () => {
      const result = FileRef.create(baseProps({ sizeBytes: 0 }));
      expect(result.isOk()).toBe(true);
    });

    it("rejects empty originalFilename", () => {
      const result = FileRef.create(baseProps({ originalFilename: "" }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidFileRefError);
    });

    it("rejects whitespace-only originalFilename", () => {
      const result = FileRef.create(baseProps({ originalFilename: "   " }));
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidFileRefError);
    });
  });

  describe("serialize() / fromSerialized()", () => {
    it("round-trips without data loss", () => {
      const props = baseProps();
      const result = FileRef.create(props);
      expect(result.isOk()).toBe(true);
      const ref = result.unwrap();
      const serialized = ref.serialize();
      const restored = FileRef.fromSerialized(serialized);
      expect(restored.key).toBe(props.key);
      expect(restored.contentType).toBe(props.contentType);
      expect(restored.sizeBytes).toBe(props.sizeBytes);
      expect(restored.originalFilename).toBe(props.originalFilename);
      expect(restored.uploadedAt).toEqual(props.uploadedAt);
    });

    it("serialize() returns all FileRefProps fields", () => {
      const props = baseProps();
      const ref = FileRef.fromSerialized(props);
      const serialized = ref.serialize();
      expect(serialized).toEqual(props);
    });
  });
});
