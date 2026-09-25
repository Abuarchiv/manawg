import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const { ModuleKind, ScriptTarget, transpileModule } = requireFromWeb('typescript');
const routePath = path.join(process.cwd(), 'src/app/api/calendar/[id]/[token]/route.ts');
const id = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const calendarSubscriptions = {
	id: 'id',
	wgId: 'wgId',
	memberId: 'memberId',
	revokedAt: 'revokedAt',
};
const wgMembers = { id: 'id', authUserId: 'authUserId', deactivatedAt: 'deactivatedAt' };
const wgs = { id: 'id' };
const wgEvents = { wgId: 'wgId', startsAt: 'startsAt' };

function harness({ authUserId = 'auth-user', deactivatedAt = null, revokedAt = null } = {}) {
	const state = {
		authUserId,
		deactivatedAt,
		revokedAt,
		wgExists: true,
		steps: [],
		events: [
			{
				id: 'event-1',
				title: 'Other member event',
				description: null,
				startsAt: new Date('2026-10-01T10:00:00.000Z'),
				endsAt: null,
				allDay: false,
				location: null,
				recurrence: null,
				createdAt: new Date('2026-09-25T00:00:00.000Z'),
				updatedAt: new Date('2026-09-25T00:00:00.000Z'),
			},
		],
	};
	const subscription = { id, wgId, tokenSeed: 'seed', memberId: 'member-1', revokedAt };
	const tx = {
		select: () => {
			let table;
			let joined = false;
			const query = {
				from(value) {
					table = value;
					return query;
				},
				innerJoin() {
					joined = true;
					return query;
				},
				where() {
					return query;
				},
				limit: async () => {
					if (table === calendarSubscriptions && joined) {
						state.steps.push('member-check');
						return state.authUserId && !state.deactivatedAt && !state.revokedAt
							? [subscription]
							: [];
					}
					if (table === calendarSubscriptions) {
						return state.revokedAt ? [] : [{ wgId }];
					}
					throw new Error(`unexpected limit query: ${String(table)}`);
				},
				for: async (lock) => {
					assert.equal(table, wgs);
					assert.equal(lock, 'update');
					state.steps.push('wg-lock');
					return state.wgExists ? [{ id: wgId }] : [];
				},
				orderBy: async () => {
					assert.equal(table, wgEvents);
					state.steps.push('events');
					return state.events;
				},
			};
			return query;
		},
	};
	const mocks = {
		'@/core/db': { calendarSubscriptions, wgEvents, wgMembers, wgs },
		'@/core/db/transaction': { withTransaction: async (operation) => operation(tx) },
		'@/core/errors': {
			notFound: (code) => Response.json({ error: code }, { status: 404 }),
			serverError: (code) => Response.json({ error: code }, { status: 500 }),
			tooMany: (code) => Response.json({ error: code }, { status: 429 }),
		},
		'@/core/guards/api-auth': { isUuid: () => true },
		'@/core/infra/observability': { logApiError: () => undefined },
		'@/core/rate-limit': {
			checkRateLimit: async () => ({ success: true }),
			clientIpKey: () => 'ip',
			wgReadLimiter: {},
		},
		'@/core/utils/time': { MS_PER_DAY: 86_400_000 },
		'@/features/events/calendar-subscription': {
			isCalendarFeedToken: () => true,
			verifyCalendarFeedToken: (_id, seed, token) => seed === 'seed' && token === 'valid',
		},
		'@/features/events/events': {
			expandRecurrence: (event) => [event],
		},
		'@/features/events/ics': {
			calendarFeedToIcs: (events) => events.map((event) => event.title).join('\n'),
		},
		'drizzle-orm': {
			and: (...parts) => ({ kind: 'and', parts }),
			asc: (value) => ({ kind: 'asc', value }),
			eq: (...parts) => ({ kind: 'eq', parts }),
			isNotNull: (value) => ({ kind: 'isNotNull', value }),
			isNull: (value) => ({ kind: 'isNull', value }),
		},
		'next/server': { NextResponse: Response },
	};
	const source = readFileSync(routePath, 'utf8');
	const compiled = transpileModule(source, {
		compilerOptions: {
			module: ModuleKind.CommonJS,
			target: ScriptTarget.ES2022,
			esModuleInterop: true,
		},
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (Object.hasOwn(mocks, name) ? mocks[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	const request = new Request(`https://example.test/api/calendar/${id}/valid`);
	return {
		state,
		get: () => module.exports.GET(request, { params: Promise.resolve({ id, token: 'valid' }) }),
	};
}

test('active Auth-linked calendar feed returns events after locking the WG', async () => {
	const { state, get } = harness();
	const response = await get();
	assert.equal(response.status, 200);
	assert.match(await response.text(), /Other member event/);
	assert.deepEqual(state.steps, ['wg-lock', 'member-check', 'events']);
});

test('detached or deactivated membership cannot use its old calendar URL', async () => {
	for (const state of [
		{ authUserId: null },
		{ deactivatedAt: new Date() },
		{ revokedAt: new Date() },
	]) {
		const { get } = harness(state);
		const response = await get();
		assert.equal(response.status, 404);
		assert.deepEqual(await response.json(), { error: 'calendar_feed_not_found' });
	}
});
