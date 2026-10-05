import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));

function loadTs(file, overrides = {}) {
	const source = transpileModule(readFileSync(path.join(process.cwd(), file), 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', source)(
		(name) => (name in overrides ? overrides[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	return module.exports;
}

function exportRoute(failedTable, { expenseCount = 0, rowsByTable = {} } = {}) {
	const tables = Object.fromEntries(
		[
			'announcementComments',
			'announcements',
			'auditEvents',
			'chores',
			'expensePayments',
			'expenseSplits',
			'expenses',
			'memberAbsences',
			'recurringExpenses',
			'shoppingItems',
			'wgChatMessages',
			'wgEvents',
			'wgMembers',
		].map((name) => [
			name,
			name === 'expensePayments'
				? {
						id: {},
						fromMemberId: {},
						toMemberId: {},
						amountCents: {},
						currency: {},
						completedAt: {},
						wgId: {},
						status: {},
					}
				: {},
		]),
	);
	const limits = [];
	const inArrayCalls = [];
	const expenseRows = Array.from({ length: expenseCount }, (_, index) => ({
		id: `expense-${index}`,
		description: 'x',
		amountCents: 1,
		currency: 'EUR',
		paidByMemberId: 'member',
		imageUrl: null,
		occurredAt: new Date(0),
	}));
	const db = {
		select: () => ({
			from: (table) => {
				const name = Object.keys(tables).find((key) => tables[key] === table);
				const rows =
					table === tables[failedTable]
						? Promise.reject(new Error('privateDbPassword123'))
						: Promise.resolve(table === tables.expenses ? expenseRows : (rowsByTable[name] ?? []));
				const query = Object.assign(rows, {
					innerJoin: () => query,
					where: () => query,
					orderBy: () => query,
					limit: (limit) => {
						limits.push(limit);
						return query;
					},
					offset: () => query,
				});
				return query;
			},
		}),
	};
	const exportModule = loadTs('src/core/reads/export.ts');
	const drizzle = {
		and: () => null,
		asc: () => null,
		desc: () => null,
		eq: () => null,
		inArray: (_column, values) => {
			inArrayCalls.push(values.length);
			return null;
		},
	};
	const { GET } = loadTs('src/app/api/wg/[code]/export/route.ts', {
		'@/core/http/read-json': { readJsonLimited: (req) => req.json() },
		'@/core/http/api-errors': {
			badRequest: (error) => Response.json({ error }, { status: 400 }),
			serverError: (_error, message) => Response.json({ error: message }, { status: 500 }),
			tooMany: () => new Response(null, { status: 429 }),
		},
		'@/core/guards/require-wg-member': {
			requireWgMember: async () => ({
				ok: true,
				wg: { id: 'wg', name: 'WG', shareCode: 'MTE8PZAT' },
				member: { memberId: 'member' },
			}),
		},
		'@/core/guards/route-preamble': {
			readShareCode: async () => ({ ok: true, code: 'MTE8PZAT' }),
			resolveE2EFixture: async () => ({ mode: 'real' }),
		},
		'@/core/infra/observability': loadTs('src/core/infra/observability.ts', {
			'./sentry': { captureSentryException() {}, logSentryApiError() {} },
			'./sentry-privacy': loadTs('src/core/infra/sentry-privacy.ts'),
		}),
		'@/core/rate-limit': { checkRateLimit: async () => ({ success: true }) },
		'@/core/reads/export': exportModule,
		'@/core/reads/export-queries': loadTs('src/core/reads/export-queries.ts', {
			'@/core/db': { db, ...tables },
			'drizzle-orm': drizzle,
			'./export': exportModule,
		}),
		'next/server': { NextResponse: Response },
	});
	return {
		limits,
		inArrayCalls,
		get: (search = '') => GET({ nextUrl: new URL(`https://example.invalid/export${search}`) }, {}),
	};
}

test('authenticated default JSON and CSV exports work without a limit', async () => {
	for (const search of ['', '?format=csv&section=expenses', '?offset=20']) {
		const route = exportRoute();
		const response = await route.get(search);
		assert.equal(response.status, 200, await response.text());
		assert.ok(route.limits.every((limit) => limit === Number.MAX_SAFE_INTEGER));
	}
});

test('explicit export limits remain bounded', async () => {
	const route = exportRoute();
	assert.equal((await route.get('?limit=20')).status, 200);
	assert.ok(route.limits.every((limit) => limit === 20));
	assert.equal((await route.get('?limit=100001')).status, 400);
	assert.equal((await route.get('?limit=0')).status, 400);
});

test('large expense id sets load splits in bind-param-safe chunks', async () => {
	for (const search of ['?format=csv&section=expenses', '?sections=expenses']) {
		const route = exportRoute(undefined, { expenseCount: 25_001 });
		const response = await route.get(search);
		assert.equal(response.status, 200, await response.text());
		assert.deepEqual(route.inArrayCalls, [10_000, 10_000, 5_001]);
	}
});

test('one failed JSON section rejects the incomplete backup', async (t) => {
	const logged = [];
	t.mock.method(console, 'error', (...args) => logged.push(args));
	for (const section of ['expenses', 'wgMembers']) {
		const response = await exportRoute(section).get('?limit=20');
		assert.equal(response.status, 500);
		assert.equal((await response.json()).error, 'export_incomplete');
	}
	assert.equal(JSON.stringify(logged).includes('privateDbPassword123'), false);
});

test('deleted chat messages export without their text or image', async () => {
	const route = exportRoute(undefined, {
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
	const response = await route.get('?sections=chatMessages');
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

	const csv = await route.get('?format=csv&section=chatMessages');
	assert.equal(csv.status, 200);
	const csvText = await csv.text();
	assert.equal(csvText.includes('privateDeletedText'), false);
	assert.equal(csvText.includes('deleted.jpg'), false);
});

test('new sections are part of the full dump and export CSV headers', async () => {
	const route = exportRoute(undefined, {
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
	const response = await route.get();
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
		const csvResponse = await route.get(`?format=csv&section=${section}`);
		assert.equal(csvResponse.status, 200);
		assert.equal(
			csvResponse.headers.get('content-disposition'),
			`attachment; filename="MTE8PZAT-${section}.csv"`,
		);
		assert.equal(await csvResponse.text(), csv);
	}
});

test('a failed new section fails the full export closed', async (t) => {
	t.mock.method(console, 'error', () => {});
	for (const table of ['wgChatMessages', 'announcementComments', 'wgEvents']) {
		const response = await exportRoute(table).get();
		assert.equal(response.status, 500);
		assert.equal((await response.json()).error, 'export_incomplete');
	}
});
