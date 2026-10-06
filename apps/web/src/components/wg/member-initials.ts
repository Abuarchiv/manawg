const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** First `count` user-perceived characters; `slice`/`[0]` would cut emoji surrogate pairs in half. */
function head(text: string, count: number): string {
	const out: string[] = [];
	for (const { segment } of graphemes.segment(text)) {
		if (out.length === count) break;
		out.push(segment);
	}
	return out.join('');
}

export function initials(name: string): string {
	// Split on whitespace AND hyphens so "Maximilian-Christopher von Hohenzollern-Sigmaringen"
	// yields "MS" (first+last word) consistently with hyphenated names.
	const parts = name
		.trim()
		.split(/[\s-]+/)
		.filter(Boolean);
	if (parts.length === 0) return '?';
	const first = parts[0] ?? '';
	if (parts.length === 1) return head(first, 2).toLocaleUpperCase('de-DE');
	const last = parts[parts.length - 1] ?? first;
	return (head(first, 1) + head(last, 1)).toLocaleUpperCase('de-DE');
}
