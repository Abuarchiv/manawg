export type ReplaySlotResult<T> = { won: true } | { won: false; cached: T };

export type ReplaySlotDependencies<T> = {
	claim: (scope: string, key: string) => Promise<boolean>;
	read: (scope: string, key: string) => Promise<T | null>;
	sleep?: (milliseconds: number) => Promise<void>;
};

const POLL_ATTEMPTS = 14;
const POLL_INTERVAL_MS = 100;
const POLL_MAX_INTERVAL_MS = 2000;

export async function claimReplaySlot<T>(
	scope: string,
	key: string,
	dependencies: ReplaySlotDependencies<T>,
): Promise<ReplaySlotResult<T>> {
	const sleep =
		dependencies.sleep ??
		((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

	if (await dependencies.claim(scope, key)) return { won: true };

	const immediate = await dependencies.read(scope, key);
	if (immediate !== null) return { won: false, cached: immediate };

	let delay = POLL_INTERVAL_MS;
	for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
		await sleep(delay);
		delay = Math.min(delay * 2, POLL_MAX_INTERVAL_MS);
		const retried = await dependencies.read(scope, key);
		if (retried !== null) return { won: false, cached: retried };
	}

	throw new Error('idempotency_response_pending');
}
