export function inputDateToIso(value: string): string {
	const parts = value.split('-').map((part) => Number.parseInt(part, 10));
	const year = parts[0];
	const month = parts[1];
	const day = parts[2];
	if (year === undefined || month === undefined || day === undefined) {
		return new Date().toISOString();
	}
	return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}
