import { badRequest, serverError, tooMany } from '@/core/errors';
import {
	ReplayCache,
	type ReplayReservation,
	claimReplaySlotWithRetry,
	replayKey,
} from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { readShareCode } from '@/core/guards/route-preamble';
import { getCachedResponse, readIdempotencyKey, setCachedResponse } from '@/core/idempotency';
import type { RouteCtx } from '@/core/infra/api-types';
import { checkRateLimit, importCommitLimiter } from '@/core/rate-limit';
import { MAX_CSV_BYTES, MAX_OCR_BYTES, readImportJsonBody } from '@/lib/wg/import-body';
import { type CommitResult, commitImport } from '@/lib/wg/import-commit';
import { hashPayload } from '@/lib/wg/import-hash';
import {
	type ParsedExpense,
	UnsupportedCurrencyError,
	findMappingConflicts,
	parseSplidCsv,
	parseSplitwiseCsv,
} from '@/lib/wg/import-parsers';
import { parseOcrText } from '@/lib/wg/ocr';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Generous TTL: a re-submitted commit (double click, retry after a client
// timeout) must replay the SAME result — with skipDuplicates:false there is
// no other guard against inserting the same expenses twice.
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

const importCommitReplay = new ReplayCache<CommitResult>(IDEMPOTENCY_TTL_MS);

function importCommitIdempotencyScope(wgId: string, memberId: string): string {
	return `import-commit:${wgId}:${memberId}`;
}

const commitSchema = z.object({
	source: z.enum(['splitwise_csv', 'splid_csv', 'ocr_text']),
	payload: z.string().min(1),
	memberMapping: z.record(z.string(), z.string().uuid().nullable()),
	previewPayloadHash: z.string().optional(),
	skipDuplicates: z.boolean().optional().default(true),
	skipIndexes: z.array(z.number().int().min(0)).optional().default([]),
});

function parseFor(source: string, payload: string): ParsedExpense[] {
	if (source === 'splitwise_csv') return parseSplitwiseCsv(payload);
	if (source === 'splid_csv') return parseSplidCsv(payload);
	return parseOcrText(payload).expenses;
}

export async function POST(
	req: NextRequest,
	ctx: RouteCtx<{ code: string }>,
): Promise<NextResponse> {
	const codeResult = await readShareCode(ctx);
	if (!codeResult.ok) return codeResult.response;
	const { code } = codeResult;
	const idemKey = readIdempotencyKey(req);
	let replayReservation: Extract<ReplayReservation<CommitResult>, { owned: true }> | null = null;

	const raw = await readImportJsonBody(req);
	if (!raw.ok) return badRequest(raw.error);
	const parsedBody = commitSchema.safeParse(raw.value);
	if (!parsedBody.success) return badRequest('invalid_body');
	const { source, payload, memberMapping, previewPayloadHash, skipDuplicates, skipIndexes } =
		parsedBody.data;

	const payloadSize = Buffer.byteLength(payload, 'utf8');
	const limit = source === 'ocr_text' ? MAX_OCR_BYTES : MAX_CSV_BYTES;
	if (payloadSize > limit) return badRequest('payload_too_large');
	const payloadHash = hashPayload(payload);
	if (skipIndexes.length > 0 && previewPayloadHash === undefined) {
		return badRequest('preview_hash_required');
	}
	if (previewPayloadHash !== undefined && previewPayloadHash !== payloadHash) {
		return badRequest('payload_changed');
	}

	try {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wg = auth.wg;

		const idemScope = idemKey ? importCommitIdempotencyScope(wg.id, auth.member.memberId) : null;
		const idemReplayKey = idemScope && idemKey ? replayKey(idemScope, idemKey) : null;

		// Replay only after WG/member auth, scoped by both IDs to prevent
		// cross-WG or cross-member response leaks for client-provided keys.
		if (idemScope && idemKey && idemReplayKey) {
			const localReplay = importCommitReplay.get(idemReplayKey);
			if (localReplay) return NextResponse.json(await localReplay);

			const cached = await getCachedResponse<CommitResult>(idemScope, idemKey);
			if (cached) {
				importCommitReplay.remember(idemReplayKey, cached);
				return NextResponse.json(cached);
			}
		}

		const limited = await checkRateLimit(
			importCommitLimiter,
			`import-commit:${wg.id}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		let parsedExpenses: ParsedExpense[];
		try {
			parsedExpenses = parseFor(source, payload);
		} catch (parseErr) {
			if (parseErr instanceof UnsupportedCurrencyError) {
				return NextResponse.json(
					{ error: 'unsupported_currency', message: parseErr.message, currency: parseErr.currency },
					{ status: 400 },
				);
			}
			throw parseErr;
		}
		if (parsedExpenses.length === 0) return badRequest('empty_payload');
		if (skipIndexes.some((index) => index >= parsedExpenses.length)) {
			return badRequest('invalid_skip_indexes');
		}

		const conflicts = findMappingConflicts(parsedExpenses, memberMapping);
		if (conflicts.length > 0) {
			return NextResponse.json({ error: 'mapping_incomplete', conflicts }, { status: 400 });
		}

		const skipSet = new Set(skipIndexes);
		const items = parsedExpenses.map((parsed, index) => ({
			parsed,
			skip: skipSet.has(index),
		}));

		const replaySlot = idemReplayKey === null ? null : importCommitReplay.reserve(idemReplayKey);
		if (replaySlot?.owned === false) {
			return NextResponse.json(await replaySlot.promise);
		}
		replayReservation = replaySlot;

		// Cross-process dedup: claim a Postgres slot so a concurrent cold Lambda
		// with the same Idempotency-Key sees our claim and fetches the cached
		// response instead of committing the import a second time.
		if (idemScope && idemKey) {
			const slot = await claimReplaySlotWithRetry<CommitResult>(idemScope, idemKey);
			if (!slot.won) {
				if (slot.cached) {
					replayReservation?.resolve(slot.cached);
					return NextResponse.json(slot.cached);
				}
				// Fall through: the other process failed. We act as the new winner.
			}
		}

		const dbSource = source === 'ocr_text' ? ('ocr_screenshot' as const) : source;
		let result: CommitResult;
		try {
			result = await commitImport({
				wg,
				source: dbSource,
				importedByMemberId: auth.member.memberId,
				importedByName: auth.member.name,
				expenses: items,
				mapping: memberMapping,
				skipDuplicates,
				rawPayloadHash: payloadHash,
			});
		} catch (writeErr) {
			replayReservation?.reject(writeErr);
			throw writeErr;
		}

		// Cache the exact response so a retry with the same Idempotency-Key
		// replays it instead of committing the import again.
		if (idemScope && idemKey && replayReservation?.owned) {
			replayReservation.resolve(result);
			void setCachedResponse(idemScope, idemKey, result).catch((err) =>
				console.warn('[imports/commit] idem cache write failed', err),
			);
		}
		return NextResponse.json(result);
	} catch (err) {
		replayReservation?.reject(err);
		if (err instanceof Error && err.message === 'member_not_in_wg') {
			return badRequest('member_not_in_wg');
		}
		console.error('[imports/commit]', err);
		return serverError(err);
	}
}
