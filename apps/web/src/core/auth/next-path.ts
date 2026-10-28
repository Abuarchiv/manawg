import { normalizeShareCode } from '@/core/utils/share-code';

export function safeNextPath(value: string | null): string {
	if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
		return '/';
	}

	try {
		const url = new URL(value, 'https://manawg.invalid');
		if (url.origin !== 'https://manawg.invalid') return '/';
		const path = `${url.pathname}${url.search}${url.hash}`;
		// Dot-segments normalize to a protocol-relative path ("/.//evil.com" →
		// "//evil.com"), which a browser resolves to another host. Re-check the
		// normalized result, not only the raw input.
		if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/';
		return path;
	} catch {
		return '/';
	}
}

/** Set by the middleware on page requests so server layouts can see the requested URL. */
export const REQUEST_PATH_HEADER = 'x-manawg-path';

/**
 * Where a sign-in redirect from a WG layout returns to: the requested page of that WG, or
 * the WG start when the header is absent or points elsewhere.
 */
export function wgReturnPath(code: string, requested: string | null): string {
	const base = `/wg/${encodeURIComponent(code)}`;
	const path = safeNextPath(requested);
	const match = /^\/wg\/([^/?#]+)([\s\S]*)$/.exec(path);
	if (!match) return base;
	let segment: string;
	try {
		segment = decodeURIComponent(match[1] ?? '');
	} catch {
		return base;
	}
	// The layout compares the normalized code, so a lowercase or look-alike spelling counts.
	return normalizeShareCode(segment) === code ? `${base}${match[2] ?? ''}` : base;
}
