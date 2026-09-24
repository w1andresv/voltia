const STATIONS_MENU_EMAIL = "w1andresv@gmail.com";

export function canSeeStationsMenu(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === STATIONS_MENU_EMAIL;
}
