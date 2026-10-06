import { TransactionAbort } from '@/core/db/transaction';
import { isWgAdmin } from '@/core/guards/admin';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, conflict, tooMany } from '@/core/http/api-errors';
import { readIdempotencyKey, setReplayWarning } from '@/core/idempotency-store';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, importCommitLimiter } from '@/core/rate-limit';
import {
	MAX_CSV_BYTES,
	MAX_IMPORT_ROWS,
	MAX_OCR_BYTES,
	readImportJsonBody,
} from '@/features/expenses/import-body';
import { commitImport } from '@/features/expenses/import-commit';
import { hashPayload } from '@/features/expenses/import-hash';
import {
	type ParsedExpense,
	UnsupportedCurrencyError,
	findMappingConflicts,
	parseSplidCsv,
	parseSplitwiseCsv,
} from '@/features/expenses/import-parsers';
import { parseOcrText } from '@/features/expenses/ocr';
import { NextResponse } from 'next/server';
import { z } from 'zod';

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

export const POST = withWgRoute('imports/commit', async (req, { code }) => {
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
		const { wg, member } = auth;

		// A re-submitted commit (double click, retry after a client timeout) must replay the
		// same result: with skipDuplicates false nothing else keeps the expenses from being
		// inserted twice. The scope holds WG and member, so a key never reaches another member.
		const scope = `import-commit:${wg.id}:${member.memberId}`;
		const key = readIdempotencyKey(req);
		const outcome = await commitImport({ scope, key }, async () => {
			const limited = await checkRateLimit(
				importCommitLimiter,
				`import-commit:${wg.id}:${member.memberId}`,
			);
			if (!limited.success) return { stop: tooMany() };

			let parsedExpenses: ParsedExpense[];
			try {
				parsedExpenses = parseFor(source, payload);
			} catch (parseErr) {
				if (parseErr instanceof UnsupportedCurrencyError) {
					return {
						stop: NextResponse.json(
							{
								error: 'unsupported_currency',
								message: parseErr.message,
								currency: parseErr.currency,
							},
							{ status: 400 },
						),
					};
				}
				throw parseErr;
			}
			if (parsedExpenses.length === 0) return { stop: badRequest('empty_payload') };
			if (parsedExpenses.length > MAX_IMPORT_ROWS) return { stop: badRequest('too_many_rows') };
			if (skipIndexes.some((index) => index >= parsedExpenses.length)) {
				return { stop: badRequest('invalid_skip_indexes') };
			}

			const skipSet = new Set(skipIndexes);
			const conflicts = findMappingConflicts(
				parsedExpenses.filter((_expense, index) => !skipSet.has(index)),
				memberMapping,
			);
			if (conflicts.length > 0) {
				return {
					stop: NextResponse.json({ error: 'mapping_incomplete', conflicts }, { status: 400 }),
				};
			}
			return {
				input: {
					wg,
					source: source === 'ocr_text' ? ('ocr_screenshot' as const) : source,
					importedByMemberId: member.memberId,
					importedByName: member.name,
					mayRecordForOthers: await isWgAdmin(wg.id, member.memberId),
					expenses: parsedExpenses.map((parsed, index) => ({ parsed, skip: skipSet.has(index) })),
					mapping: memberMapping,
					skipDuplicates,
					rawPayloadHash: payloadHash,
				},
			};
		});
		if (outcome.kind === 'stopped') return outcome.response;
		const { result } = outcome;
		if (outcome.kind === 'committed' && key && result.warning !== null) {
			try {
				const persisted = await setReplayWarning(
					scope,
					key,
					{
						match: [{ path: ['importId'], equals: result.importId }],
						warningPath: ['warning'],
						replaces: [null, result.warning],
					},
					result.warning,
				);
				if (!persisted) {
					logApiError(
						'[imports/commit] replay warning persistence failed',
						new Error('replay_row_missing'),
					);
				}
			} catch (warningErr) {
				logApiError('[imports/commit] replay warning persistence failed', warningErr);
			}
		}
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof TransactionAbort && err.code === 'paypal_payment_pending') {
			return conflict('paypal_payment_pending');
		}
		if (err instanceof Error && err.message === 'member_not_in_wg') {
			return badRequest('member_not_in_wg');
		}
		throw err;
	}
});
