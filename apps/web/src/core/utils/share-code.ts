export { isValidShareCode, normalizeShareCode } from '@/shared/lib/share-code';

/**
 * Crockford base32 alphabet. Includes 0 and 1 (excludes I, L, O, U as
 * look-alikes). 32^8 ≈ 1.1 trillion combinations.
 */
const SHARE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SHARE_CODE_LENGTH = 8;

export function generateShareCode(): string {
	// 32 symbols divide 256 evenly, so masking a random byte stays unbiased.
	const bytes = crypto.getRandomValues(new Uint8Array(SHARE_CODE_LENGTH));
	return Array.from(bytes, (byte) => SHARE_CODE_ALPHABET[byte & 31]).join('');
}
