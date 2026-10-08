import 'server-only';
import { type ReplayCodec, withIdempotentWrite } from '@/core/db/idempotent-write';
import { type DbTransaction, lockExpensePayments, withTransaction } from '@/core/db/transaction';
import { readIdempotencyKey, setReplayWarning } from '@/core/idempotency-store';

export interface AnnouncementReplayResponse {
	status: number;
	body: unknown;
	entityId?: string;
}

export interface AnnouncementMutation<T> {
	response: AnnouncementReplayResponse;
	effect: T | null;
}

function isCompletedResponse(value: unknown): value is AnnouncementReplayResponse {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Number.isInteger((value as AnnouncementReplayResponse).status) &&
		(value as AnnouncementReplayResponse).status >= 200 &&
		(value as AnnouncementReplayResponse).status < 600 &&
		'body' in value
	);
}

function announcementCodec(
	legacyResponse?: (value: unknown) => AnnouncementReplayResponse | null,
): ReplayCodec<unknown> {
	return {
		// `entityId` stays in the stored row so a post-commit warning finds its response.
		encode: (response) => {
			const { status, body, entityId } = response as AnnouncementReplayResponse;
			return entityId === undefined ? { status, body } : { status, body, entityId };
		},
		decode: (stored) => (isCompletedResponse(stored) ? stored : (legacyResponse?.(stored) ?? null)),
	};
}

/**
 * Pinnwand writes (posts, comments, reactions and shopping notices) behind the shared claim.
 * Every outcome except a rate limit is stored, so a retry of a rejected write replays the
 * rejection; a rate-limited write can run again once the limit clears. `wgId` takes the WG's
 * payment lock first, in the same order as expense writes.
 */
export async function withAnnouncementReplay<T>(
	req: Request,
	scope: string,
	mutate: (tx: DbTransaction) => Promise<AnnouncementMutation<T>>,
	legacyResponse?: (value: unknown) => AnnouncementReplayResponse | null,
	wgId?: string,
): Promise<AnnouncementMutation<T> & { key: string | null }> {
	const key = readIdempotencyKey(req);
	const result = await withIdempotentWrite(
		{
			scope,
			key,
			codec: announcementCodec(legacyResponse),
			storeStatus: (status) => status !== 429,
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
	const { kind: _kind, ...response } = result;
	return { response, effect: null, key };
}

export function persistAnnouncementReplayWarning(
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
