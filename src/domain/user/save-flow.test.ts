import { describe, expect, it } from "vitest";
import { decideSaveAction } from "./save-flow";

describe("decideSaveAction", () => {
  it("con sesión guarda directo en la cuenta, aunque haya una elección de invitado vieja", () => {
    expect(decideSaveAction({ kind: "authenticated", rememberedGuestChoice: false })).toBe(
      "save-account",
    );
    expect(decideSaveAction({ kind: "authenticated", rememberedGuestChoice: true })).toBe(
      "save-account",
    );
  });

  it("invitado sin elección: pregunta", () => {
    expect(decideSaveAction({ kind: "guest", rememberedGuestChoice: false })).toBe("ask");
  });

  it("invitado que eligió no iniciar sesión: guarda en el navegador sin preguntar", () => {
    expect(decideSaveAction({ kind: "guest", rememberedGuestChoice: true })).toBe("save-browser");
  });
});
