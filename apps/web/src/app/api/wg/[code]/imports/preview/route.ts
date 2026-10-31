import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, wgMembers } from '@/core/db';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, rateLimitResponse } from '@/core/http/api-errors';
import { requestLocale } from '@/core/i18n/request-locale';
import { checkRateLimit, importLimiter } from '@/core/rate-limit';
import {
	MAX_CSV_BYTES,
	MAX_IMPORT_ROWS,
	MAX_OCR_BYTES,
	readImportJsonBody,
} from '@/features/expenses/import-body';
import { importMemberMappingSchema } from '@/features/expenses/import-member-mapping-schema';
import {
	collectUniqueNames,
	findMappingConflicts,
	matchMembers,
	parseSplidCsv,
	parseSplitwiseCsv,
	type RejectedRow,
} from '@/features/expenses/import-parsers';
import { parseOcrText } from '@/features/expenses/ocr';
import { hashPayload } from '@/features/expenses/server/import-hash';

const previewSchema = z.object({
	source: z.enum(['splitwise_csv', 'splid_csv', 'ocr_text']),
	payload: z.string().min(1),
	memberMapping: importMemberMappingSchema(z.string().nullable()).optional(),
});

export const POST = withWgRoute('imports/preview', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	const raw = await readImportJsonBody(req);
	if (!raw.ok) return badRequest(raw.error);
	const parsedBody = previewSchema.safeParse(raw.value);
	if (!parsedBody.success) return badRequest('invalid_body');
	const { source, payload, memberMapping } = parsedBody.data;
	const payloadSize = Buffer.byteLength(payload, 'utf8');
	const limit = source === 'ocr_text' ? MAX_OCR_BYTES : MAX_CSV_BYTES;
	if (payloadSize > limit) return badRequest('payload_too_large');

	const limited = rateLimitResponse(
		await checkRateLimit(importLimiter, `import-preview:${wg.id}:${auth.member.memberId}`),
	);
	if (limited) return limited;

	const rejected: RejectedRow[] = [];
	const parsedExpenses =
		source === 'splitwise_csv'
			? parseSplitwiseCsv(payload, rejected, requestLocale(req))
			: source === 'splid_csv'
				? parseSplidCsv(payload, rejected, requestLocale(req))
				: parseOcrText(payload).expenses;

	if (parsedExpenses.length > MAX_IMPORT_ROWS || rejected.length > MAX_IMPORT_ROWS) {
		return badRequest('too_many_rows');
	}

	// Same contract as the commit: only active members can be mapped, so a
	// clean preview never turns into member_not_in_wg on commit.
	const members = await db
		.select({ id: wgMembers.id, name: wgMembers.name })
		.from(wgMembers)
		.where(and(eq(wgMembers.wgId, wg.id), isNull(wgMembers.deactivatedAt)));
	const activeMemberIds = new Set(members.map((member) => member.id));

	const names = collectUniqueNames(parsedExpenses);
	const fuzzyNames = new Set<string>();
	const autoMatched = matchMembers(names, members, fuzzyNames);
	const mappingEntries: [string, string | null][] = [];
	for (const name of names) {
		const explicit =
			memberMapping && Object.hasOwn(memberMapping, name) ? memberMapping[name] : undefined;
		const candidate = explicit ?? autoMatched.get(name);
		// A mapping the member chose explicitly is not a guess.
		if (explicit) fuzzyNames.delete(name);
		// An unknown or moved-out member id becomes a conflict for that name.
		mappingEntries.push([name, candidate && activeMemberIds.has(candidate) ? candidate : null]);
	}
	const mapping = Object.fromEntries(mappingEntries);
	const conflicts = findMappingConflicts(parsedExpenses, mapping);

	return NextResponse.json({
		parsed: parsedExpenses,
		payloadHash: hashPayload(payload),
		memberMapping: mapping,
		conflicts,
		members,
		rejected,
		fuzzyNames: Array.from(fuzzyNames),
	});
});
