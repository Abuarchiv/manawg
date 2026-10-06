import { createHash } from 'node:crypto';

/**
 * Fingerprint of the uploaded file, binding a preview to the commit that
 * follows it: the skip indexes the user picked only mean anything for the exact
 * payload they saw.
 *
 * Lives in its own module because the preview route needs nothing else from the
 * import: importing it from `import-commit` would pull the database and the
 * transaction pool in behind it.
 */
export function hashPayload(payload: string): string {
	return createHash('sha256').update(payload, 'utf8').digest('hex');
}
