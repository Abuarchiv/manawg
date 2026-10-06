/** Share-code format: 8 symbols of the Crockford base32 alphabet (see `core/utils/share-code`). */
const SHARE_CODE_REGEX = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;
/** Look-alikes a person is likely to type for the excluded letters. */
const LOOKALIKES: Record<string, string> = { I: '1', L: '1', O: '0', U: 'V' };

export function isValidShareCode(code: string): boolean {
	return typeof code === 'string' && SHARE_CODE_REGEX.test(code);
}

export function normalizeShareCode(input: string): string {
	return input
		.trim()
		.toUpperCase()
		.replace(/[ILOU]/g, (ch) => LOOKALIKES[ch] ?? ch);
}
