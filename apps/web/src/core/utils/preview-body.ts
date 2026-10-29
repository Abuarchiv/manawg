export function previewBody(body: string | null | undefined, max = 120): string {
	if (typeof body !== 'string') return '';
	const normalized = body.replace(/\s+/g, ' ').trim();
	// Code points, not UTF-16 units: slicing mid-surrogate leaves a broken "�" at the cut.
	const chars = Array.from(normalized);
	return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : normalized;
}
