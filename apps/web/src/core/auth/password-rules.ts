/**
 * Minimum for passwords chosen now (sign-up, reset). GoTrue enforces the same value through
 * GOTRUE_PASSWORD_MIN_LENGTH (compose.yaml) and minimum_password_length (real-stack config).
 */
export const NEW_PASSWORD_MIN_LENGTH = 8;

/**
 * Minimum for signing in. Accounts created before the minimum was raised may still use
 * 6 characters, so it stays lower than NEW_PASSWORD_MIN_LENGTH.
 */
export const SIGN_IN_PASSWORD_MIN_LENGTH = 6;

/** Counts characters as GoTrue does: Unicode code points, so an emoji is one, not two. */
export function isNewPasswordTooShort(password: string): boolean {
	return [...password].length < NEW_PASSWORD_MIN_LENGTH;
}

/**
 * Counts UTF-16 units on purpose: never stricter than older GoTrue releases were when existing
 * passwords were set, so the form cannot lock anyone out; GoTrue decides at sign-in.
 */
export function isSignInPasswordTooShort(password: string): boolean {
	return password.length < SIGN_IN_PASSWORD_MIN_LENGTH;
}
