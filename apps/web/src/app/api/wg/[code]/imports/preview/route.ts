import { badRequest, tooMany } from '@/lib/api-error';
import { db, wgMembers } from '@/lib/db';
import { checkRateLimit, importLimiter } from '@/lib/rate-limit';
import { MAX_CSV_BYTES, MAX_OCR_BYTES, readImportJsonBody } from '@/lib/wg/import-body';
import { hashPayload } from '@/lib/wg/import-hash';
import {
	type ParsedExpense,
	UnsupportedCurrencyError,
	collectUniqueNames,
	findMappingConflicts,
	matchMembers,
	parseSplidCsv,
	parseSplitwiseCsv,
} from '@/lib/wg/import-parsers';
import { parseOcrText } from '@/lib/wg/ocr';
import { requireWgMember } from '@/lib/wg/require-wg-member';
import { withWgRoute } from '@/lib/wg/with-wg-route';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const previewSchema = z.object({
	source: z.enum(['splitwise_csv', 'splid_csv', 'ocr_text']),
	payload: z.string().min(1),
	memberMapping: z.record(z.string(), z.string().nullable()).optional(),
});

export const POST = withWgRoute('imports/preview', async (req, { code }) => {
	const raw = await readImportJsonBody(req);
	if (!raw.ok) return badRequest(raw.error);
	const parsedBody = previewSchema.safeParse(raw.value);
	if (!parsedBody.success) return badRequest('invalid_body');
	const { source, payload, memberMapping } = parsedBody.data;
	const payloadSize = Buffer.byteLength(payload, 'utf8');
	const limit = source === 'ocr_text' ? MAX_OCR_BYTES : MAX_CSV_BYTES;
	if (payloadSize > limit) return badRequest('payload_too_large');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	const limited = await checkRateLimit(
		importLimiter,
		`import-preview:${wg.id}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	let parsedExpenses: ParsedExpense[];
	try {
		parsedExpenses =
			source === 'splitwise_csv'
				? parseSplitwiseCsv(payload)
				: source === 'splid_csv'
					? parseSplidCsv(payload)
					: parseOcrText(payload).expenses;
	} catch (parseErr) {
		if (parseErr instanceof UnsupportedCurrencyError) {
			return NextResponse.json(
				{ error: 'unsupported_currency', message: parseErr.message, currency: parseErr.currency },
				{ status: 400 },
			);
		}
		throw parseErr;
	}

	const members = await db
		.select({ id: wgMembers.id, name: wgMembers.name })
		.from(wgMembers)
		.where(eq(wgMembers.wgId, wg.id));

	const names = collectUniqueNames(parsedExpenses);
	const autoMatched = matchMembers(names, members);
	const mapping: Record<string, string | null> = {};
	for (const name of names) {
		mapping[name] = memberMapping?.[name] ?? autoMatched.get(name) ?? null;
	}
	const conflicts = findMappingConflicts(parsedExpenses, mapping);

	return NextResponse.json({
		parsed: parsedExpenses,
		payloadHash: hashPayload(payload),
		memberMapping: mapping,
		conflicts,
		members,
	});
});
