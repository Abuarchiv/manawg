import { regexes } from 'zod/v4/core';

/**
 * Same rule as `emailField` in core/auth/route-schemas.ts (trim, zod's email pattern, at most
 * 254 characters), so the form flags every address the auth routes reject. Only the pattern is
 * imported, which keeps the zod schema runtime out of the sign-in bundle.
 */
export function isValidEmail(value: string): boolean {
	const address = value.trim().toLowerCase();
	return address.length <= 254 && regexes.email.test(address);
}
