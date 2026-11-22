import type { WgChangeVersions } from '@/core/db/change-versions';

type Watched = Pick<WgChangeVersions, 'members' | 'data'>;

/**
 * Long-poll core of `GET /api/wg/[code]/changes?members=…&data=…`: reads the versions every
 * `stepMs` until the roster or the data moved past `since` (a join, a revoked invitation), the
 * request is aborted or `timeoutMs` passed, and answers with the last versions read.
 */
export async function waitForChange(
	read: () => Promise<WgChangeVersions>,
	since: Watched,
	{ timeoutMs, stepMs, signal }: { timeoutMs: number; stepMs: number; signal?: AbortSignal },
): Promise<WgChangeVersions> {
	const until = Date.now() + timeoutMs;
	for (;;) {
		const current = await read();
		const moved = current.members !== since.members || current.data !== since.data;
		if (moved || signal?.aborted || Date.now() + stepMs > until) return current;
		await new Promise((resolve) => setTimeout(resolve, stepMs));
	}
}
