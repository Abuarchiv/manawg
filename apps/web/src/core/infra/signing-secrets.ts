function listed(raw: string | undefined): string[] {
	return (raw ?? '')
		.split(',')
		.map((secret) => secret.trim())
		.filter((secret) => secret.length > 0);
}

/** The secret new signatures use; null when it is not configured. */
export function currentSigningSecret(): string | null {
	return listed(process.env.MEMBER_SESSION_SECRET)[0] ?? null;
}

/**
 * Secrets a signature may still verify against: the current one first, then the ones in
 * `MEMBER_SESSION_SECRET_PREVIOUS` (comma-separated). During a rotation the old secret stays
 * listed, so calendar feeds and unsubscribe links keep working until the old one is removed.
 */
export function acceptedSigningSecrets(): string[] {
	const current = currentSigningSecret();
	if (!current) return [];
	return [current, ...listed(process.env.MEMBER_SESSION_SECRET_PREVIOUS)];
}
