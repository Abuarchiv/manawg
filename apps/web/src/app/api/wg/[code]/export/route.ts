import { requireWgMember } from '@/core/guards/require-wg-member';
import { readShareCode, resolveE2EFixture } from '@/core/guards/route-preamble';
import { badRequest, serverError, tooMany } from '@/core/http/api-errors';
import type { RouteCtx } from '@/core/infra/api-types';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, wgExportLimiter } from '@/core/rate-limit';
import {
	EXPORT_SECTION_KEYS,
	type ExportRow,
	type ExportSectionKey,
	buildWgExport,
	getExportSectionHeaders,
	getExportSectionRows,
	isExportSectionKey,
	toCsv,
} from '@/core/reads/export';
import {
	type ExportPage,
	MEMBER_NAME_SECTIONS,
	type MemberRows,
	NO_EXPORT_LIMIT,
	buildSectionLoaders,
	countExportSections,
	fetchMemberRows,
	mapMemberRows,
	toMemberById,
} from '@/core/reads/export-queries';
import { type NextRequest, NextResponse } from 'next/server';

function getExportFormat(req: NextRequest): 'json' | 'csv' | null {
	const format = req.nextUrl.searchParams.get('format');
	if (format === null || format === 'json') return 'json';
	if (format === 'csv') return 'csv';
	return null;
}

const EXPORT_LIMIT_MAX = 100_000;

/**
 * Optional `limit`/`offset` params so a huge WG can page through the dump
 * instead of materialising every row in one response. Without params the
 * sections are returned without a row cap, as before.
 * Returns `null` when a param is present but unusable; `explicit` tells the
 * response whether to echo a `pagination` block.
 */
function parseExportPage(req: NextRequest): { page: ExportPage; explicit: boolean } | null {
	const params = req.nextUrl.searchParams;
	const rawLimit = params.get('limit');
	const rawOffset = params.get('offset');
	const limit = rawLimit === null ? NO_EXPORT_LIMIT : Number.parseInt(rawLimit, 10);
	const offset = rawOffset === null ? 0 : Number.parseInt(rawOffset, 10);
	if (!Number.isFinite(limit) || limit < 1 || (rawLimit !== null && limit > EXPORT_LIMIT_MAX)) {
		return null;
	}
	if (!Number.isFinite(offset) || offset < 0) return null;
	return { page: { limit, offset }, explicit: rawLimit !== null || rawOffset !== null };
}

/**
 * Optional `sections=members,expenses` param for the JSON dump: only the
 * requested sections are fetched, bounding both memory and query load.
 * Returns `null` when a requested key is unknown.
 */
function parseRequestedSections(req: NextRequest): readonly ExportSectionKey[] | null {
	const raw = req.nextUrl.searchParams.get('sections');
	if (raw === null) return EXPORT_SECTION_KEYS;
	const parts = raw
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (parts.length === 0) return null;
	const sections: ExportSectionKey[] = [];
	for (const part of parts) {
		if (!isExportSectionKey(part)) return null;
		if (!sections.includes(part)) sections.push(part);
	}
	return sections;
}

/** The single `section` of a CSV download; `null` when the key is unknown. */
function parseCsvSection(req: NextRequest): ExportSectionKey | null {
	const requested = req.nextUrl.searchParams.get('section');
	if (requested === null) return 'expenses';
	return isExportSectionKey(requested) ? requested : null;
}

type SectionResult<T> =
	| { section: ExportSectionKey; ok: true; value: T }
	| { section: ExportSectionKey; ok: false };

/**
 * Log each failed section while allowing the other section reads to settle.
 */
async function settleSection<T>(
	section: ExportSectionKey,
	fn: () => Promise<T>,
): Promise<SectionResult<T>> {
	try {
		return { section, ok: true, value: await fn() };
	} catch (err) {
		logApiError(`[export GET] section ${section} failed`, err);
		return { section, ok: false };
	}
}

/** `?summary=counts`: per-section row counts for the settings page, no rows. */
function wantsCountsOnly(req: NextRequest): boolean {
	return req.nextUrl.searchParams.get('summary') === 'counts';
}

function sectionRecord(
	rowsFor: (section: ExportSectionKey) => ExportRow[],
): Record<ExportSectionKey, ExportRow[]> {
	return Object.fromEntries(
		EXPORT_SECTION_KEYS.map((section) => [section, rowsFor(section)]),
	) as Record<ExportSectionKey, ExportRow[]>;
}

function csvExportResponse(
	shareCode: string,
	section: ExportSectionKey,
	rows: Array<Record<string, unknown>>,
): NextResponse {
	return new NextResponse(toCsv(rows, getExportSectionHeaders(section)), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${shareCode}-${section}.csv"`,
		},
	});
}

export async function GET(
	req: NextRequest,
	ctx: RouteCtx<{ code: string }>,
): Promise<NextResponse> {
	const codeResult = await readShareCode(ctx);
	if (!codeResult.ok) return codeResult.response;
	const { code } = codeResult;
	const format = getExportFormat(req);
	if (!format) return badRequest('format_invalid');

	const e2e = await resolveE2EFixture(req, code);
	if (e2e.mode === 'denied') return e2e.response;
	if (e2e.mode === 'fixture') {
		const { fixture } = e2e;
		const now = new Date().toISOString();
		const members = fixture.members.map((member) => ({
			id: member.id,
			name: member.name,
			createdAt: now,
		}));
		const data = buildWgExport({
			wg: { name: fixture.name, shareCode: fixture.shareCode },
			...sectionRecord((section) => (section === 'members' ? members : [])),
		});
		if (wantsCountsOnly(req)) {
			return NextResponse.json({
				counts: Object.fromEntries(
					EXPORT_SECTION_KEYS.map((section) => [section, data.sections[section].length]),
				),
			});
		}
		if (format === 'csv') {
			const section = parseCsvSection(req);
			if (!section) return badRequest('section_invalid');
			return csvExportResponse(fixture.shareCode, section, getExportSectionRows(data, section));
		}
		return NextResponse.json(data);
	}

	try {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wg = auth.wg;

		// Keyed per member rather than per IP: a whole WG can sit behind one NAT,
		// and one member's export budget must not lock out their flatmates.
		const limit = await checkRateLimit(wgExportLimiter, `export:${wg.id}:${auth.member.memberId}`);
		if (!limit.success) return tooMany('rate_limited');

		if (wantsCountsOnly(req)) {
			return NextResponse.json({ counts: await countExportSections(wg.id) });
		}

		const parsedPage = parseExportPage(req);
		if (!parsedPage) return badRequest('pagination_invalid');
		const { page, explicit: pageExplicit } = parsedPage;

		if (format === 'csv') {
			const section = parseCsvSection(req);
			if (!section) return badRequest('section_invalid');

			// The section's own queries are the only things that can fail here —
			// a failure is logged with the section name and surfaced as a
			// section-specific error instead of a generic 500.
			const loaders = buildSectionLoaders(wg.id, page, async () =>
				toMemberById(await fetchMemberRows(wg.id)),
			);
			const settled = await settleSection(section, loaders[section]);
			if (!settled.ok) return serverError(null, `export_section_failed:${section}`);
			return csvExportResponse(wg.shareCode, section, settled.value);
		}

		const parsedSections = parseRequestedSections(req);
		if (!parsedSections) return badRequest('section_invalid');
		const requestedSections = parsedSections;

		// The directory fetch is shared and always covers the full roster; its
		// failure marks exactly those sections failed that join member names.
		const needsDirectory = requestedSections.some((section) =>
			MEMBER_NAME_SECTIONS.includes(section as Exclude<ExportSectionKey, 'members'>),
		);
		const wantsMembers = requestedSections.includes('members');
		let memberRowsFetched: MemberRows | null = null;
		let directoryFailed = false;
		if (wantsMembers || needsDirectory) {
			try {
				memberRowsFetched = await fetchMemberRows(wg.id);
			} catch (err) {
				directoryFailed = true;
				logApiError('[export GET] section members failed', err);
			}
		}
		const memberById = memberRowsFetched
			? toMemberById(memberRowsFetched)
			: new Map<string, string>();
		const loaders = buildSectionLoaders(wg.id, page, async () => {
			if (directoryFailed) throw new Error('member_directory_unavailable');
			return memberById;
		});

		const failedSections: string[] = [];
		const rowsBySection = new Map<ExportSectionKey, ExportRow[]>();
		if (wantsMembers) {
			if (directoryFailed || !memberRowsFetched) failedSections.push('members');
			// Members are never paged (see fetchMemberRows) — the full roster
			// doubles as the name directory for every other section.
			else rowsBySection.set('members', mapMemberRows(memberRowsFetched));
		}

		const dependentKeys = requestedSections.filter((section) => section !== 'members');
		const settledSections = await Promise.all(
			dependentKeys.map((section) => settleSection(section, loaders[section])),
		);
		for (const result of settledSections) {
			if (result.ok) rowsBySection.set(result.section, result.value);
			else failedSections.push(result.section);
		}

		// An export must contain every requested section.
		if (failedSections.length > 0) {
			return serverError(null, 'export_incomplete');
		}

		const data = buildWgExport({
			wg: { name: wg.name, shareCode: wg.shareCode },
			...sectionRecord((section) => rowsBySection.get(section) ?? []),
		});

		return NextResponse.json({
			...data,
			failedSections,
			...(pageExplicit ? { pagination: { limit: page.limit, offset: page.offset } } : {}),
		});
	} catch (err) {
		logApiError('[export GET]', err);
		return serverError(err);
	}
}
