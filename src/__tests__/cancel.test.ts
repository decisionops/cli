import { describe, it, expect } from "bun:test";
import { CancelError, isCancelError } from "../ui/cancel.js";

describe("CancelError", () => {
  it("is an instance of Error", () => {
    const err = new CancelError();
    expect(err).toBeInstanceOf(Error);
  });

  it("has name 'CancelError'", () => {
    const err = new CancelError();
    expect(err.name).toBe("CancelError");
  });

  it("has message 'Cancelled.'", () => {
    const err = new CancelError();
    expect(err.message).toBe("Cancelled.");
  });
});

describe("isCancelError", () => {
  it("returns true for CancelError instances", () => {
    expect(isCancelError(new CancelError())).toBe(true);
  });

  it("returns false for generic Error", () => {
    expect(isCancelError(new Error("Cancelled."))).toBe(false);
  });

  it("returns false for null, undefined, and non-error objects", () => {
    expect(isCancelError(null)).toBe(false);
    expect(isCancelError(undefined)).toBe(false);
    expect(isCancelError("CancelError")).toBe(false);
    expect(isCancelError({ name: "CancelError", message: "Cancelled." })).toBe(false);
  });
});
