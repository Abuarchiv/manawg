import { logApiError } from '@/core/infra/observability';

/**
 * Keeps a post-commit warning only if it was also written into the stored idempotent response.
 * The stored response is what a retry replays, so a warning that could not be stored (row
 * missing, update failed) is dropped from the live response too: original and replay agree.
 * Resolves to the warning to send, or `null`.
 */
export async function persistWarningOrDrop<W extends string>(
	label: string,
	warning: W,
	persist: (warning: W) => Promise<boolean>,
): Promise<W | null> {
	try {
		if (await persist(warning)) return warning;
		logApiError(`${label} replay warning persistence failed`, new Error('replay_row_missing'));
	} catch (err) {
		logApiError(`${label} replay warning persistence failed`, err);
	}
	return null;
}
