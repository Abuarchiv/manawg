import { NextResponse } from 'next/server';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	forbidden,
	notFound,
	rateLimitResponse,
	unreadableJsonBody,
} from '@/core/http/api-errors';
import { readJsonLimited } from '@/core/http/read-json';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { isRecord } from '@/core/utils/is-record';
import {
	type UndoCompletionInput,
	undoChoreCompletion,
} from '@/features/chores/server/undo-completion';

function parseDate(value: unknown): Date | null {
	if (typeof value !== 'string') return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? new Date(time) : null;
}

/** A member id as the client echoes it: a UUID, or `null` for an unassigned chore. */
function parseAssignee(value: unknown): string | null | undefined {
	if (value === null) return null;
	return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined;
}

function parseUndoBody(raw: unknown): (UndoCompletionInput & { ok: true }) | { ok: false } {
	if (!isRecord(raw) || !isRecord(raw.previous)) return { ok: false };
	const completionId = raw.completionId;
	const previous = {
		nextDueAt: parseDate(raw.previous.nextDueAt),
		assignedMemberId: parseAssignee(raw.previous.assignedMemberId),
		anchorAt: parseDate(raw.previous.anchorAt),
	};
	const expected = {
		nextDueAt: parseDate(raw.expectedNextDueAt),
		assignedMemberId: parseAssignee(raw.expectedAssignedMemberId),
	};
	if (
		typeof completionId !== 'string' ||
		!UUID_PATTERN.test(completionId) ||
		!previous.nextDueAt ||
		!previous.anchorAt ||
		previous.assignedMemberId === undefined ||
		!expected.nextDueAt ||
		expected.assignedMemberId === undefined
	) {
		return { ok: false };
	}
	return {
		ok: true,
		completionId,
		previous: {
			nextDueAt: previous.nextDueAt,
			assignedMemberId: previous.assignedMemberId,
			anchorAt: previous.anchorAt,
		},
		expected: { nextDueAt: expected.nextDueAt, assignedMemberId: expected.assignedMemberId },
	};
}

/** Takes back the caller's own completion shortly after it was made. */
export const POST = withWgRoute<{ id: string }>(
	'chore complete undo POST',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const { wg, member } = auth;

		let raw: unknown;
		try {
			raw = await readJsonLimited(req);
		} catch (err) {
			return unreadableJsonBody(err);
		}
		const parsed = parseUndoBody(raw);
		if (!parsed.ok) return badRequest('undo_invalid');

		const limited = rateLimitResponse(
			await checkRateLimit(wgWriteLimiter, `chore:${wg.id}:${member.memberId}`),
		);
		if (limited) return limited;

		const result = await undoChoreCompletion(wg.id, id, member, parsed);
		if (result.ok) return NextResponse.json({ chore: result.chore });
		if (result.error === 'chore_not_found') return notFound('chore_not_found');
		if (result.error === 'not_owner') return forbidden('not_owner', 'not_owner');
		// A completion that is gone, too old, not the latest or on a changed chore: no side effects.
		return conflict(result.error);
	},
);
