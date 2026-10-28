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
