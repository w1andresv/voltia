import { describe, expect, it } from "vitest";
import { canSeeGuides } from "./guide-access";

describe("canSeeGuides", () => {
  it("solo la cuenta del dueño, sin importar mayúsculas ni espacios", () => {
    expect(canSeeGuides("w1andresv@gmail.com")).toBe(true);
    expect(canSeeGuides(" W1andresV@Gmail.com ")).toBe(true);
    expect(canSeeGuides("otra@example.com")).toBe(false);
    expect(canSeeGuides(null)).toBe(false);
    expect(canSeeGuides(undefined)).toBe(false);
  });
});
