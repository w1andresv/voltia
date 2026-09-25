/**
 * Qué hace "Guardar ruta" según quién es el usuario:
 *  - con sesión: guarda en su cuenta, sin preguntar;
 *  - invitado que ya eligió "Guardar sin iniciar sesión" (vigente 180 días): guarda en el navegador;
 *  - invitado sin elección: muestra el diálogo con las dos opciones.
 */
export type SaveAction = "save-account" | "save-browser" | "ask";

export function decideSaveAction(input: {
  kind: "guest" | "authenticated";
  rememberedGuestChoice: boolean;
}): SaveAction {
  if (input.kind === "authenticated") return "save-account";
  return input.rememberedGuestChoice ? "save-browser" : "ask";
}
