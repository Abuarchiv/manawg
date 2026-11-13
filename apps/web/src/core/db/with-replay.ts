import 'server-only';
import {
	isStoredResponse,
	type ReplayCodec,
	withIdempotentWrite,
} from '@/core/db/idempotent-write';
import { type DbTransaction, lockExpensePayments, withTransaction } from '@/core/db/transaction';
import { readIdempotencyKey, setReplayWarning } from '@/core/idempotency-store';

export interface IdempotentReplayResponse {
	status: number;
	body: unknown;
	entityId?: string;
}

export interface IdempotentReplayMutation<T> {
	response: IdempotentReplayResponse;
	effect: T | null;
}

const replayCodec: ReplayCodec<unknown> = {
	// `entityId` stays in the stored row so a post-commit warning finds its response.
	encode: (response) => {
		const { status, body, entityId } = response as IdempotentReplayResponse;
		return entityId === undefined ? { status, body } : { status, body, entityId };
	},
	decode: (stored) =>
		// Keeps `entityId` from the stored row, which `readStoredResponse` would drop.
		isStoredResponse(stored) ? (stored as IdempotentReplayResponse) : null,
};

/**
 * A write whose outcome is stored as `{ status, body }` behind the shared claim (announcement posts,
 * comments, reactions, shopping item updates).
 * Every outcome of `mutate` is stored, so a retry of a rejected write replays the rejection.
 * `wgId` takes the WG's payment lock first, in the same order as expense writes.
 *
 * `admit` is where rate limits run: after a stored replay lookup missed and the claim is won, but
 * before the lock and the transaction, so its network call holds neither and only the request that
 * writes spends budget. A non-null answer releases the claim and ends the request unstored; a
 * stored replay is looked up first, so it wins over a limit.
 */
export async function withIdempotentReplay<T>(
	req: Request,
	scope: string,
	mutate: (tx: DbTransaction) => Promise<IdempotentReplayMutation<T>>,
	wgId?: string,
	admit?: () => Promise<IdempotentReplayResponse | null>,
): Promise<IdempotentReplayMutation<T> & { key: string | null }> {
	const key = readIdempotencyKey(req);
	const result = await withIdempotentWrite(
		{
			scope,
			key,
			codec: replayCodec,
			storeStatus: () => true,
			afterClaim: admit ?? (async () => null),
			inTransaction: (work) =>
				withTransaction(async (tx) => {
					if (wgId) await lockExpensePayments(tx, wgId);
					return work(tx);
				}),
		},
		async (tx) => {
			const mutation = await mutate(tx);
			return { ...mutation.response, context: mutation };
		},
	);
	if (result.kind === 'written' && result.context) return { ...result.context, key };
	if (result.kind === 'stopped') return { response: result.response, effect: null, key };
	const { kind: _kind, ...response } = result;
	return { response, effect: null, key };
}

export function persistReplayWarning(
	scope: string,
	key: string,
	entityId: string,
	warning: 'notification_delivery_failed' | 'notification_delivery_unknown',
): Promise<boolean> {
	return setReplayWarning(
		scope,
		key,
		{
			match: [
				{ path: ['entityId'], equals: entityId },
				{ path: ['status'], equals: '200' },
			],
			warningPath: ['body', 'warning'],
			replaces: [null, warning],
		},
		warning,
	);
}
