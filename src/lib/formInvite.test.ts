import { describe, expect, it } from "vitest";
import { isFormInviteCode } from "./formInvite";

describe("isFormInviteCode", () => {
  it("aceita exatamente 6 dígitos", () => {
    expect(isFormInviteCode("000000")).toBe(true);
    expect(isFormInviteCode("123456")).toBe(true);
  });

  it("rejeita outros formatos", () => {
    expect(isFormInviteCode("12345")).toBe(false);
    expect(isFormInviteCode("1234567")).toBe(false);
    expect(isFormInviteCode("12a456")).toBe(false);
  });
});
