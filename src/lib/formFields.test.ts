import { describe, expect, it } from "vitest";
import { normalizeFormFields, pickResponseValue, slugifyKey } from "./formFields";

describe("form fields", () => {
  it("normalizes legacy string fields", () => {
    const fields = normalizeFormFields(["nome", "email", "telefone"]);
    expect(fields[0]).toMatchObject({ key: "nome", label: "nome", type: "text", required: true });
    expect(fields.map((field) => field.key)).toEqual(["nome", "email", "telefone"]);
  });

  it("slugifies labels", () => {
    expect(slugifyKey("E-mail principal")).toBe("e_mail_principal");
  });

  it("picks response values case-insensitively", () => {
    expect(pickResponseValue({ Nome: "Ana" }, ["nome", "name"])).toBe("Ana");
  });
});
