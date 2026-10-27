/** Count with its German noun, e.g. `pluralize(2, 'Tag', 'Tage')` is "2 Tage". */
export function pluralize(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}
