export function parseQuietHour(value: string): number | null {
	if (value === '') return null;
	if (!/^\d{1,2}$/.test(value)) return null;
	const hour = Number(value);
	return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

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
