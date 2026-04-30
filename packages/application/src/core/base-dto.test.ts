import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BaseDto, DtoValidationError } from "./base-dto.js";

const PersonSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().nonnegative(),
});

describe("BaseDto", () => {
  describe("validate()", () => {
    it("returns Ok for input matching schema", () => {
      const result = BaseDto.validate(PersonSchema, { name: "Jane", age: 30 });
      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.name).toBe("Jane");
      expect(value.age).toBe(30);
    });

    it("returns Err(DtoValidationError) for missing required field", () => {
      const result = BaseDto.validate(PersonSchema, { age: 30 });
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err(DtoValidationError) for wrong field type", () => {
      const result = BaseDto.validate(PersonSchema, { name: "Jane", age: "not-a-number" });
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("carries issues array on validation failure", () => {
      const result = BaseDto.validate(PersonSchema, { name: "", age: -1 });
      expect(result.isErr()).toBe(true);
      const err = result.unwrapErr();
      expect(err.issues.length).toBeGreaterThan(0);
    });

    it("returns Ok for valid input with optional extra properties stripped by Zod", () => {
      const result = BaseDto.validate(PersonSchema, { name: "Jane", age: 30, extra: "ignored" });
      // Zod strips by default — result is still Ok
      expect(result.isOk()).toBe(true);
    });
  });

  describe("DtoValidationError", () => {
    it("has code === 'DTO_VALIDATION_FAILED'", () => {
      const result = BaseDto.validate(PersonSchema, {});
      expect(result.isErr()).toBe(true);
      const err = result.unwrapErr();
      expect(err.code).toBe("DTO_VALIDATION_FAILED");
    });

    it("issues have path and message fields", () => {
      const result = BaseDto.validate(PersonSchema, { name: "", age: 30 });
      expect(result.isErr()).toBe(true);
      const err = result.unwrapErr();
      expect(err.issues.length).toBeGreaterThan(0);
      const issue = err.issues[0];
      expect(issue).toHaveProperty("path");
      expect(issue).toHaveProperty("message");
    });

    it("error message includes field path information", () => {
      const result = BaseDto.validate(PersonSchema, { name: 123, age: 30 });
      expect(result.isErr()).toBe(true);
      const err = result.unwrapErr();
      expect(err.message).toContain("name");
    });
  });
});
