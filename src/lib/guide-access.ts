/** Las guías "Cómo funciona" (/v1/como-funciona, /v2/como-funciona) son solo para esta cuenta. */
const GUIDE_EMAIL = "w1andresv@gmail.com";

export function canSeeGuides(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === GUIDE_EMAIL;
}
