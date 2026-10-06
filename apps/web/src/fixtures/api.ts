import {
	EXPORT_SECTION_KEYS,
	type ExportRow,
	type ExportSectionKey,
	buildWgExport,
	getExportSectionHeaders,
	getExportSectionRows,
	isExportSectionKey,
	toCsv,
} from '@/composition/export';
import { badRequest, notFound, unauthorized } from '@/core/http/api-errors';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
import { MS_PER_DAY } from '@/core/utils/time';
import { toChatUnreadCountResponse } from '@/features/chat/chat-unread-count';
import { groupItemsByCategory } from '@/features/inventory/inventory';
import { MEMBER_NAME_MAX_LENGTH, WG_NAME_MAX_LENGTH } from '@/shared/lib/limits';
import { EXPECTED_MEMBER_ID_HEADER } from '@/shared/lib/member-header';
import { type NextRequest, NextResponse } from 'next/server';
import { type E2EWgFixture, E2E_CREATED_WG, buildE2EDashboardData, getE2EWgFixture } from './data';

/**
 * API answers of the database-free Playwright build, served by the middleware
 * before any route handler runs. Requests that return `null` here fall through
 * to the real route, which answers its own validation errors (invalid share
 * code, unknown export format, invalid create body) without a database.
 */

type MemberRead = (req: NextRequest, fixture: E2EWgFixture) => NextResponse;

/** Member-gated `GET /api/wg/[code]/<path>` reads, keyed by the path after the share code. */
const MEMBER_READS: Record<string, MemberRead> = {
	absences: () => NextResponse.json({ absences: [] }),
	activity: () => NextResponse.json({ items: [], reminders: [] }),
	announcements: () => NextResponse.json({ announcements: [] }),
	'announcements/*/comments': () => NextResponse.json({ comments: [] }),
	'calendar-subscription': () =>
		NextResponse.json(
			{ subscription: null },
			{ headers: { 'Cache-Control': 'private, no-store' } },
		),
	'chat/unread-count': () => NextResponse.json(toChatUnreadCountResponse(0)),
	chores: (_req, fixture) =>
		NextResponse.json({
			chores: [
				{
					id: 'dc02a93f-59f6-4cf9-80a7-53d4a407cb49',
					wgId: fixture.id,
					title: 'Bad putzen',
					intervalDays: 7,
					recurrenceType: 'days',
					assignedMemberId: fixture.members[0]?.id ?? null,
					nextDueAt: new Date(Date.now() + MS_PER_DAY).toISOString(),
					createdAt: new Date().toISOString(),
					lastCompletedAt: null,
					lastCompletedByName: null,
					openGapCountForAssignee: 0,
				},
			],
		}),
	dashboard: (_req, fixture) => NextResponse.json(buildE2EDashboardData(fixture.shareCode)),
	events: () => NextResponse.json({ events: [] }),
	expenses: () => NextResponse.json({ expenses: [], payments: [] }),
	export: exportResponse,
	inventory: () => {
		const items: never[] = [];
		return NextResponse.json({ items, grouped: groupItemsByCategory(items) });
	},
	members: (_req, fixture) => NextResponse.json({ members: fixture.members }),
	'recurring-expenses': (_req, fixture) =>
		NextResponse.json({
			recurringExpenses: [
				{
					id: 'a1ef32d5-d40a-4df2-9977-7684dce7df3f',
					wgId: fixture.id,
					createdByMemberId: fixture.members[0]?.id ?? '',
					paidByMemberId: fixture.members[0]?.id ?? '',
					description: 'Internet',
					amountCents: 3290,
					currency: 'EUR',
					intervalMonths: 1,
					nextDueAt: new Date(Date.now() - MS_PER_DAY).toISOString(),
					lastCreatedAt: null,
					pausedAt: null,
					createdAt: new Date().toISOString(),
					splits: [{ debtorMemberId: fixture.members[0]?.id ?? '', amountCents: 3290 }],
				},
			],
		}),
	'reminders/balances': () => NextResponse.json({ balances: [] }),
	shopping: () => NextResponse.json({ items: [] }),
};

function exportResponse(req: NextRequest, fixture: E2EWgFixture): NextResponse {
	const params = req.nextUrl.searchParams;
	const now = new Date().toISOString();
	const members: ExportRow[] = fixture.members.map((member) => ({
		id: member.id,
		name: member.name,
		createdAt: now,
	}));
	const data = buildWgExport({
		wg: { name: fixture.name, shareCode: fixture.shareCode },
		...(Object.fromEntries(
			EXPORT_SECTION_KEYS.map((section): [ExportSectionKey, ExportRow[]] => [
				section,
				section === 'members' ? members : [],
			]),
		) as Record<ExportSectionKey, ExportRow[]>),
	});
	if (params.get('summary') === 'counts') {
		return NextResponse.json({
			counts: Object.fromEntries(
				EXPORT_SECTION_KEYS.map((section) => [section, data.sections[section].length]),
			),
		});
	}
	if (params.get('format') === 'csv') {
		const requested = params.get('section') ?? 'expenses';
		if (!isExportSectionKey(requested)) return badRequest('section_invalid');
		return new NextResponse(
			toCsv(getExportSectionRows(data, requested), getExportSectionHeaders(requested)),
			{
				headers: {
					'content-type': 'text/csv; charset=utf-8',
					'content-disposition': `attachment; filename="${fixture.shareCode}-${requested}.csv"`,
				},
			},
		);
	}
	return NextResponse.json(data);
}

/** The export route rejects an unknown format before anything else; leave that to it. */
function exportFormatValid(req: NextRequest): boolean {
	const format = req.nextUrl.searchParams.get('format');
	return format === null || format === 'json' || format === 'csv';
}

/**
 * The fixture still enforces membership: without the check the database-free
 * mode would be an unauthenticated read of WG data, and CI runs with it enabled.
 */
function memberRead(req: NextRequest, code: string, read: MemberRead): NextResponse {
	const fixture = getE2EWgFixture(code);
	if (!fixture) return notFound('wg_not_found');
	// No Supabase session here: the tab's expected-member header names the caller.
	const memberId = req.headers.get(EXPECTED_MEMBER_ID_HEADER);
	if (!memberId) return unauthorized('auth_required', 'auth_required');
	if (!fixture.members.some((member) => member.id === memberId)) {
		return unauthorized('not_a_member', 'not_a_member');
	}
	return read(req, fixture);
}

/** `GET /api/wg/[code]`: the WG bootstrap, answered as the first fixture member. */
function wgBootstrap(code: string): NextResponse {
	const fixture = getE2EWgFixture(code);
	if (!fixture) return notFound('wg_not_found');
	return NextResponse.json({
		wg: {
			id: fixture.id,
			name: fixture.name,
			shareCode: fixture.shareCode,
			joiningEnabled: fixture.joiningEnabled,
			shareCodeRotatedAt: fixture.shareCodeRotatedAt,
			createdAt: new Date().toISOString(),
		},
		members: fixture.members,
		...(fixture.members[0]
			? {
					currentMember: { memberId: fixture.members[0].id, name: fixture.members[0].name },
				}
			: {}),
	});
}

/**
 * The create route's body rules, without zod: this module ships inside the
 * Edge middleware bundle. Anything it rejects falls through to the route.
 */
function trimmedName(value: unknown, max: number): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length >= 1 && trimmed.length <= max ? trimmed : null;
}

/** `POST /api/wg`: every valid create lands on the fixture "created" WG. */
async function createWg(req: NextRequest): Promise<NextResponse | null> {
	let raw: unknown;
	try {
		raw = await req.clone().json();
	} catch {
		return null;
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const body = raw as Record<string, unknown>;
	const name = trimmedName(body.name, WG_NAME_MAX_LENGTH);
	const creatorName = trimmedName(body.creatorName, MEMBER_NAME_MAX_LENGTH);
	if (!name || !creatorName) return null;
	return NextResponse.json({
		wg: { id: E2E_CREATED_WG.id, shareCode: E2E_CREATED_WG.shareCode, name },
		creator: { id: E2E_CREATED_WG.member.id, name: creatorName },
	});
}

function readShareCode(segment: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(segment);
	} catch {
		return null;
	}
	const code = normalizeShareCode(decoded);
	return isValidShareCode(code) ? code : null;
}

/** Answer a WG API request from the fixtures, or `null` to let the route handle it. */
export async function answerFixtureApiRequest(req: NextRequest): Promise<NextResponse | null> {
	const path = req.nextUrl.pathname;
	if (path === '/api/wg') return req.method === 'POST' ? createWg(req) : null;
	if (req.method !== 'GET') return null;

	const [, api, wgSegment, codeSegment, ...rest] = path.split('/');
	if (api !== 'api' || wgSegment !== 'wg' || !codeSegment) return null;
	const code = readShareCode(codeSegment);
	if (!code) return null;
	if (rest.length === 0) return wgBootstrap(code);

	const key =
		rest.length === 3 && rest[0] === 'announcements' && rest[2] === 'comments'
			? 'announcements/*/comments'
			: rest.join('/');
	const read = Object.hasOwn(MEMBER_READS, key) ? MEMBER_READS[key] : undefined;
	if (!read) return null;
	if (key === 'export' && !exportFormatValid(req)) return null;
	return memberRead(req, code, read);
}
