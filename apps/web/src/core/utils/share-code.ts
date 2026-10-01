/**
 * Crockford base32 alphabet. Includes 0 and 1 (excludes I, L, O, U as
 * look-alikes). 32^8 ≈ 1.1 trillion combinations.
 */
const SHARE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SHARE_CODE_LENGTH = 8;
const SHARE_CODE_REGEX = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;
/** Look-alikes a person is likely to type for the excluded letters. */
const LOOKALIKES: Record<string, string> = { I: '1', L: '1', O: '0', U: 'V' };

export function generateShareCode(): string {
	// 32 symbols divide 256 evenly, so masking a random byte stays unbiased.
	const bytes = crypto.getRandomValues(new Uint8Array(SHARE_CODE_LENGTH));
	return Array.from(bytes, (byte) => SHARE_CODE_ALPHABET[byte & 31]).join('');
}

export function isValidShareCode(code: string): boolean {
	return typeof code === 'string' && SHARE_CODE_REGEX.test(code);
}

export function normalizeShareCode(input: string): string {
	return input
		.trim()
		.toUpperCase()
		.replace(/[ILOU]/g, (ch) => LOOKALIKES[ch] ?? ch);
}
