import {
	createIdempotencyKey,
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';

/** The key of a transfer whose outcome is unknown; a retry for the same member reuses it. */
export interface PendingAdminTransfer {
	current: PendingIdempotentRequest | null;
}

interface AdminTransferRequest {
	adminsUrl: string;
	actorMemberId: string;
	targetMemberId: string;
	pending: PendingAdminTransfer;
	createKey?: () => string | null;
}

/**
 * Hands the admin role to one member under an idempotency key. A response that never arrived
 * keeps the key, so the retry replays the applied transfer instead of answering 403 not_admin.
 */
export async function postAdminTransfer({
	adminsUrl,
	actorMemberId,
	targetMemberId,
	pending,
	createKey = createIdempotencyKey,
}: AdminTransferRequest) {
	const key = resolveIdempotencyKey(pending.current, targetMemberId, createKey);
	if (key) pending.current = { fingerprint: targetMemberId, key };
	const res = await apiFetch<{ member: { id: string; name: string } }>(adminsUrl, {
		method: 'POST',
		memberId: actorMemberId,
		...(key && { headers: { 'Idempotency-Key': key } }),
		body: JSON.stringify({}),
	});
	if (res.ok || shouldReleaseIdempotencyKey(res.status, res.error)) pending.current = null;
	return res;
}
