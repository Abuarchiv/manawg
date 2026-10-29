import { type NextRequest, NextResponse } from 'next/server';
import {
	buildWgExport,
	EXPORT_SECTION_KEYS,
	type ExportRow,
	type ExportSectionKey,
	getExportSectionHeaders,
	isExportSectionKey,
	toCsv,
} from '@/composition/export';
import {
	buildSectionLoaders,
	countExportSections,
	type ExportPage,
	fetchMemberRows,
	MEMBER_NAME_SECTIONS,
	type MemberRows,
	mapMemberRows,
	NO_EXPORT_LIMIT,
	toMemberById,
} from '@/composition/export-queries';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, rateLimitResponse, serverError } from '@/core/http/api-errors';
import { requestLocale } from '@/core/i18n/request-locale';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, wgExportLimiter } from '@/core/rate-limit';
import { DEFAULT_LOCALE, type Locale } from '@/shared/i18n/locale';

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
	if (!Number.isSafeInteger(offset) || offset < 0) return null;
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

/** The CSV follows the downloader's locale; a bare request without cookies reads as German. */
function csvLocale(req: NextRequest): Locale {
	return req.cookies && req.headers ? requestLocale(req) : DEFAULT_LOCALE;
}

function csvExportResponse(
	shareCode: string,
	section: ExportSectionKey,
	rows: Array<Record<string, unknown>>,
	locale: Locale,
): NextResponse {
	return new NextResponse(toCsv(rows, getExportSectionHeaders(section), locale), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${shareCode}-${section}.csv"`,
		},
	});
}

export const GET = withWgRoute('export GET', async (req, { code }) => {
	const format = getExportFormat(req);
	if (!format) return badRequest('format_invalid');
	{
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wg = auth.wg;

		// Keyed per member rather than per IP: a whole WG can sit behind one NAT,
		// and one member's export budget must not lock out their flatmates.
		const limit = rateLimitResponse(
			await checkRateLimit(wgExportLimiter, `export:${wg.id}:${auth.member.memberId}`),
			'rate_limited',
		);
		if (limit) return limit;

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
			const locale = csvLocale(req);
			const loaders = buildSectionLoaders(
				wg.id,
				page,
				async () => toMemberById(await fetchMemberRows(wg.id)),
				locale,
			);
			const settled = await settleSection(section, loaders[section]);
			if (!settled.ok) return serverError(null, `export_section_failed:${section}`);
			return csvExportResponse(wg.shareCode, section, settled.value, locale);
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
		const loaders = buildSectionLoaders(
			wg.id,
			page,
			async () => {
				if (directoryFailed) throw new Error('member_directory_unavailable');
				return memberById;
			},
			csvLocale(req),
		);

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
	}
});
