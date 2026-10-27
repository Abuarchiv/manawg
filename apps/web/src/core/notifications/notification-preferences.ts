/** Settings copy for quiet hours; mirrors the urgent events and the reminder mail fallback in dispatch. */
export const QUIET_HOURS_HINT =
	'Zeiten in Berlin-Zeit. In der Ruhezeit kommen keine Push-Hinweise, sie werden auch nicht nachgeschickt. Fällige Aufgaben, Termine und kurzfristige Terminänderungen kommen trotzdem durch. Zahlungserinnerungen gehen dann per E-Mail an deine bestätigte Adresse, wenn du ein Konto hast.';

export function isQuietHoursActive(
	currentHour: number,
	quietStartHour: number | null,
	quietEndHour: number | null,
): boolean {
	if (quietStartHour === null || quietEndHour === null) return false;
	if (quietStartHour === quietEndHour) return false;
	if (quietStartHour < quietEndHour) {
		return currentHour >= quietStartHour && currentHour < quietEndHour;
	}
	return currentHour >= quietStartHour || currentHour < quietEndHour;
}
