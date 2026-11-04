// zod's email pattern (`regexes.email` in zod/v4/core), copied because client modules may not
// import zod. email-format.test.ts runs the same addresses through `emailField`, so a zod update
// that changes the rule fails that test.
export const EMAIL_PATTERN =
	/^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

/**
 * Same rule as `emailField` in core/auth/route-schemas.ts (trim, lower-case, zod's email pattern,
 * at most 254 characters), so the form flags every address the auth routes reject.
 */
export function isValidEmail(value: string): boolean {
	const address = value.trim().toLowerCase();
	return address.length <= 254 && EMAIL_PATTERN.test(address);
}
