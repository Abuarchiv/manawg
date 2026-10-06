import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
	type ExportDbState,
	LEAKED_SECRET,
	mockExportDb,
	resetExportDb,
} from '../../../../../../tests/support/export-db';
import {
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../tests/support/route-harness';

// Errors go through the real redacting observability module; only Sentry is a stand-in.
const db = mockExportDb();
mockRateLimit();
mockWgMember({
	wg: { id: 'wg', name: 'WG', shareCode: 'MTE8PZAT' },
	member: { memberId: 'member', name: 'Alice' },
});
mock.module('@/core/infra/sentry', {
	namedExports: {
		captureSentryException: () => undefined,
		logSentryApiError: () => undefined,
		initializeSentry: () => undefined,
	},
});

const { GET } = await import('./route');

function given(next: Partial<ExportDbState> & { expenseCount?: number } = {}): void {
	const { expenseCount = 0, ...rest } = next;
	resetExportDb(db, rest);
	db.rowsByTable.expenses = Array.from({ length: expenseCount }, (_, index) => ({
		id: `expense-${index}`,
		description: 'x',
		amountCents: 1,
		currency: 'EUR',
		paidByMemberId: 'member',
		imageUrl: null,
		occurredAt: new Date(0),
	}));
}

const get = (search = '') => GET(request(`/api/wg/MTE8PZAT/export${search}`), routeCtx());

test('authenticated default JSON and CSV exports work without a limit', async () => {
	for (const search of ['', '?format=csv&section=expenses', '?offset=20']) {
		given();
		const response = await get(search);
		assert.equal(response.status, 200, await response.text());
		assert.ok(db.limits.every((limit) => limit === Number.MAX_SAFE_INTEGER));
	}
});

test('explicit export limits remain bounded', async () => {
	given();
	assert.equal((await get('?limit=20')).status, 200);
	assert.ok(db.limits.every((limit) => limit === 20));
	assert.equal((await get('?limit=100001')).status, 400);
	assert.equal((await get('?limit=0')).status, 400);
});

test('large expense id sets load splits in bind-param-safe chunks', async () => {
	for (const search of ['?format=csv&section=expenses', '?sections=expenses']) {
		given({ expenseCount: 25_001 });
		const response = await get(search);
		assert.equal(response.status, 200, await response.text());
		assert.deepEqual(db.inArrayCalls, [10_000, 10_000, 5_001]);
	}
});

test('one failed JSON section rejects the incomplete backup', async (t) => {
	const logged: unknown[][] = [];
	t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args));
	for (const section of ['expenses', 'wgMembers'] as const) {
		given({ failedTable: section });
		const response = await get('?limit=20');
		assert.equal(response.status, 500);
		assert.equal((await response.json()).error, 'export_incomplete');
	}
	assert.equal(JSON.stringify(logged).includes(LEAKED_SECRET), false);
});

test('deleted chat messages export without their text or image', async () => {
	given({
		rowsByTable: {
			wgMembers: [{ id: 'member', name: 'Alice', createdAt: new Date(0) }],
			wgChatMessages: [
				{
					id: 'message-live',
					senderMemberId: 'member',
					kind: 'image',
					body: 'Hallo',
					imageUrl: 'https://img.example/live.jpg',
					replyToMessageId: null,
					editedAt: null,
					deletedAt: null,
					createdAt: new Date('2026-03-01T10:00:00Z'),
				},
				{
					id: 'message-deleted',
					senderMemberId: 'member',
					kind: 'image',
					body: 'privateDeletedText',
					imageUrl: 'https://img.example/deleted.jpg',
					replyToMessageId: 'message-live',
					editedAt: new Date('2026-03-01T10:05:00Z'),
					deletedAt: new Date('2026-03-01T10:06:00Z'),
					createdAt: new Date('2026-03-01T10:01:00Z'),
				},
				{
					id: 'message-system',
					senderMemberId: null,
					kind: 'system',
					body: null,
					imageUrl: null,
					replyToMessageId: null,
					editedAt: null,
					deletedAt: null,
					createdAt: new Date('2026-03-01T10:02:00Z'),
				},
			],
		},
	});
	const response = await get('?sections=chatMessages');
	assert.equal(response.status, 200);
	const { sections } = await response.json();
	assert.deepEqual(sections.chatMessages, [
		{
			id: 'message-live',
			createdAt: '2026-03-01T10:00:00.000Z',
			senderName: 'Alice',
			kind: 'image',
			body: 'Hallo',
			imageUrl: 'https://img.example/live.jpg',
			editedAt: null,
			deletedAt: null,
			replyToMessageId: null,
		},
		{
			id: 'message-deleted',
			createdAt: '2026-03-01T10:01:00.000Z',
			senderName: 'Alice',
			kind: 'image',
			body: null,
			imageUrl: '',
			editedAt: '2026-03-01T10:05:00.000Z',
			deletedAt: '2026-03-01T10:06:00.000Z',
			replyToMessageId: 'message-live',
		},
		{
			id: 'message-system',
			createdAt: '2026-03-01T10:02:00.000Z',
			senderName: 'System',
			kind: 'system',
			body: null,
			imageUrl: '',
			editedAt: null,
			deletedAt: null,
			replyToMessageId: null,
		},
	]);

	const csv = await get('?format=csv&section=chatMessages');
	assert.equal(csv.status, 200);
	const csvText = await csv.text();
	assert.equal(csvText.includes('privateDeletedText'), false);
	assert.equal(csvText.includes('deleted.jpg'), false);
});

test('new sections are part of the full dump and export CSV headers', async () => {
	given({
		rowsByTable: {
			wgMembers: [{ id: 'member', name: 'Alice', createdAt: new Date(0) }],
			announcementComments: [
				{
					id: 'comment',
					announcementId: 'post',
					memberId: 'member',
					content: '=HYPERLINK("x")',
					createdAt: new Date('2026-03-02T08:00:00Z'),
				},
			],
			wgEvents: [
				{
					id: 'event',
					title: 'Putzparty',
					description: null,
					startsAt: new Date('2026-03-05T18:00:00Z'),
					endsAt: null,
					allDay: false,
					location: 'Küche',
					recurrence: null,
					createdByMemberId: null,
					createdAt: new Date('2026-03-01T08:00:00Z'),
				},
			],
		},
	});
	const response = await get();
	assert.equal(response.status, 200);
	const { sections, failedSections } = await response.json();
	assert.deepEqual(failedSections, []);
	assert.deepEqual(sections.chatMessages, []);
	assert.deepEqual(sections.announcementComments, [
		{
			id: 'comment',
			announcementId: 'post',
			authorName: 'Alice',
			content: '=HYPERLINK("x")',
			createdAt: '2026-03-02T08:00:00.000Z',
		},
	]);
	assert.equal(sections.events[0].createdByName, '');

	const expected = {
		chatMessages: 'id;createdAt;senderName;kind;body;imageUrl;editedAt;deletedAt;replyToMessageId',
		announcementComments:
			'id;announcementId;authorName;content;createdAt\ncomment;post;Alice;"\'=HYPERLINK(""x"")";2026-03-02T08:00:00.000Z',
		events:
			'id;title;description;startsAt;endsAt;allDay;location;recurrence;createdByName;createdAt\nevent;Putzparty;;2026-03-05T18:00:00.000Z;;false;Küche;;;2026-03-01T08:00:00.000Z',
	};
	for (const [section, csv] of Object.entries(expected)) {
		const csvResponse = await get(`?format=csv&section=${section}`);
		assert.equal(csvResponse.status, 200);
		assert.equal(
			csvResponse.headers.get('content-disposition'),
			`attachment; filename="MTE8PZAT-${section}.csv"`,
		);
		assert.equal(await csvResponse.text(), csv);
	}
});

test('a failed new section fails the full export closed', async (t) => {
	t.mock.method(console, 'error', () => undefined);
	for (const table of ['wgChatMessages', 'announcementComments', 'wgEvents'] as const) {
		given({ failedTable: table });
		const response = await get();
		assert.equal(response.status, 500);
		assert.equal((await response.json()).error, 'export_incomplete');
	}
});

test('the counts summary counts rows per section instead of downloading them', async () => {
	given({ rowsByTable: { wgChatMessages: [{ value: 3 }], wgMembers: [{ value: 2 }] } });
	const response = await get('?summary=counts');
	assert.equal(response.status, 200);
	const { counts } = await response.json();
	assert.equal(counts.chatMessages, 3);
	assert.equal(counts.members, 2);
	assert.equal(counts.expenses, 0);
	assert.equal(Object.keys(counts).length, 12);
	assert.deepEqual(db.limits, []);
});
