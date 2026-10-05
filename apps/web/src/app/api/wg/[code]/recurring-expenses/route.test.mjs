import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { loadClaimedResponse } from '../../../../../../tests/support/claimed-response.cjs';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const srcRoot = path.join(process.cwd(), 'src');
const routePath = path.join(srcRoot, 'app/api/wg/[code]/recurring-expenses/route.ts');
const templateId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const creatorId = '33333333-3333-4333-8333-333333333333';
const otherMemberId = '44444444-4444-4444-8444-444444444444';
const currentDueAt = new Date('2026-10-01T00:00:00.000Z');

function loadTs(filePath, mocks) {
	const source = transpileModule(readFileSync(filePath, 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	const require = (name) => {
		if (Object.hasOwn(mocks, name)) return mocks[name];
		// Pure helpers run for real so the route is exercised with its actual validation.
		if (name.startsWith('@/')) return loadTs(path.join(srcRoot, `${name.slice(2)}.ts`), mocks);
		return requireFromWeb(name);
	};
	new Function('require', 'module', 'exports', source)(require, module, module.exports);
	return module.exports;
}

function harness({ callerId = otherMemberId, isAdmin = false } = {}) {
	const recurringExpenses = {
		id: 'recurringExpenses.id',
		wgId: 'recurringExpenses.wgId',
		nextDueAt: 'recurringExpenses.nextDueAt',
		pausedAt: 'recurringExpenses.pausedAt',
	};
	const wgMembers = { id: 'wgMembers.id' };
	const state = {
		template: {
			id: templateId,
			wgId,
			createdByMemberId: creatorId,
			paidByMemberId: creatorId,
			description: 'Miete',
			amountCents: 500,
			currency: 'EUR',
			intervalMonths: 1,
			nextDueAt: currentDueAt,
			anchorAt: currentDueAt,
			lastCreatedAt: null,
			pausedAt: null,
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
			splitsJson: JSON.stringify([{ debtorMemberId: creatorId, amountCents: 500 }]),
		},
		updates: [],
		ownerChecks: 0,
	};
	const db = {
		select() {
			let table;
			const query = {
				from(selected) {
					table = selected;
					return query;
				},
				where() {
					const rows = table === wgMembers ? [{ id: creatorId }] : [{ ...state.template }];
					return Object.assign(Promise.resolve(rows), { limit: async () => rows });
				},
			};
			return query;
		},
		update() {
			let values;
			return {
				set(next) {
					values = next;
					return this;
				},
				where() {
					return {
						returning: async () => {
							state.updates.push(values);
							state.template = { ...state.template, ...values };
							return [{ ...state.template }];
						},
					};
				},
			};
		},
	};
	const errorResponse = (code, status) => Response.json({ error: code }, { status });
	const mocks = {
		'@/core/audit': { recordAuditEvent: async () => {} },
		'@/core/db': { db, idempotencyResponses: {}, recurringExpenses, wgMembers },
		'@/core/db/transaction': { TransactionAbort: class TransactionAbort extends Error {} },
		'@/core/http/read-json': { readJsonLimited: (req) => req.json() },
		'@/core/http/api-errors': {
			apiError: (code, status) => errorResponse(code, status),
			badRequest: (code) => errorResponse(code, 400),
			conflict: (code) => errorResponse(code, 409),
			notFound: (code) => errorResponse(code, 404),
			serverError: () => errorResponse('server_error', 500),
			tooMany: () => errorResponse('rate_limited', 429),
		},
		'@/core/guards/admin': {
			requireOwnerOrAdmin: async (_wgId, member, ownerId) => {
				state.ownerChecks++;
				return member.memberId === ownerId || isAdmin ? null : errorResponse('forbidden', 403);
			},
		},
		'@/core/guards/idempotency': {
			ReplayCache: class ReplayCache {},
			claimReplaySlotWithRetry: async () => null,
			replayKey: () => '',
		},
		'@/core/guards/require-wg-member': {
			requireWgMember: async () => ({
				ok: true,
				wg: { id: wgId },
				member: { memberId: callerId, name: 'Kim' },
			}),
		},
		'@/core/guards/route-preamble': { readShareCode: async () => ({ ok: true, code: 'MTE8PZAT' }) },
		'@/core/guards/with-wg-route': {
			withWgRoute: (_label, handler) => (req) => handler(req, { code: 'MTE8PZAT' }),
		},
		'@/core/idempotency-store': {
			RESPONSE_REPLAY_TTL_SECONDS: 60,
			getCachedResponse: async () => null,
			readIdempotencyKey: () => null,
		},
		'@/core/infra/observability': { logApiError: () => {} },
		'@/core/rate-limit': { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
		'@/features/expenses/expense-payments': { withExpensePaymentLock: async () => {} },
		'@/features/expenses/paid-by-guard': { checkPaidByGuard: () => ({ ok: true }) },
		'drizzle-orm': new Proxy({}, { get: () => () => ({}) }),
		'next/server': {
			NextResponse: Object.assign(class extends Response {}, {
				json: (body, init) => Response.json(body, init),
			}),
		},
	};
	mocks['@/core/db/claimed-response'] = loadClaimedResponse(mocks);
	const route = loadTs(routePath, mocks);
	return {
		state,
		patch: (body) =>
			route.PATCH(
				new Request('https://example.test/api/wg/MTE8PZAT/recurring-expenses', {
					method: 'PATCH',
					body: JSON.stringify({ id: templateId, ...body }),
				}),
			),
	};
}

test('PATCH rejects moving nextDueAt out of the catch-up range', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-25T12:00:00.000Z') });
	const { state, patch } = harness({ callerId: creatorId });
	for (const nextDueAt of ['2000-01-01T00:00:00.000Z', '2040-01-01T00:00:00.000Z']) {
		const response = await patch({ description: 'Miete', nextDueAt });
		assert.equal(response.status, 400);
		assert.deepEqual(await response.json(), { error: 'due_date_invalid' });
	}
	assert.deepEqual(state.updates, []);

	const moved = await patch({ nextDueAt: '2026-11-01T00:00:00.000Z' });
	assert.equal(moved.status, 200);
	assert.equal(state.template.nextDueAt.toISOString(), '2026-11-01T00:00:00.000Z');
});

test('any member may advance a template after booking it, but only the owner may edit it', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-25T12:00:00.000Z') });
	const { state, patch } = harness({ callerId: otherMemberId });

	const edit = await patch({ description: 'Strom' });
	assert.equal(edit.status, 403);
	assert.equal(state.template.description, 'Miete');

	const advanced = await patch({ expectedNextDueAt: currentDueAt.toISOString() });
	assert.equal(advanced.status, 200);
	assert.equal(state.template.nextDueAt.toISOString(), '2026-11-01T00:00:00.000Z');

	// The expectedNextDueAt check still rejects a stale or replayed advance.
	const replay = await patch({ expectedNextDueAt: currentDueAt.toISOString() });
	assert.equal(replay.status, 409);
	assert.equal(state.template.nextDueAt.toISOString(), '2026-11-01T00:00:00.000Z');
});

test('PATCH resending the unchanged due date keeps the cadence anchor', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-25T12:00:00.000Z') });
	const { state, patch } = harness({ callerId: creatorId });
	// A "31st" template whose due date was clamped to the 28th after February.
	const anchorAt = new Date('2026-01-31T11:00:00.000Z');
	const clampedDueAt = new Date('2026-10-28T11:00:00.000Z');
	state.template.anchorAt = anchorAt;
	state.template.nextDueAt = clampedDueAt;

	const edit = await patch({ description: 'Miete neu', nextDueAt: '2026-10-28T10:00:00.000Z' });
	assert.equal(edit.status, 200);
	assert.equal(state.template.anchorAt.toISOString(), anchorAt.toISOString());
	assert.equal(state.template.nextDueAt.toISOString(), clampedDueAt.toISOString());

	const moved = await patch({ nextDueAt: '2026-11-15T11:00:00.000Z' });
	assert.equal(moved.status, 200);
	assert.equal(state.template.anchorAt.toISOString(), '2026-11-15T11:00:00.000Z');
});

test('PATCH from an editor that loaded an older due date is refused, not written back', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-25T12:00:00.000Z') });
	const { state, patch } = harness({ callerId: creatorId });
	const loadedDueAt = state.template.nextDueAt.toISOString();
	// A booking (cron or "Erfassen") moved the template on after the form was opened.
	state.template.nextDueAt = new Date('2026-11-01T11:00:00.000Z');

	const stale = await patch({
		description: 'Miete neu',
		nextDueAt: loadedDueAt,
		expectedNextDueAt: loadedDueAt,
	});
	assert.equal(stale.status, 409);
	assert.deepEqual(await stale.json(), { error: 'recurring_expense_changed' });
	assert.equal(state.updates.length, 0);
	assert.equal(state.template.nextDueAt.toISOString(), '2026-11-01T11:00:00.000Z');

	const fresh = await patch({
		description: 'Miete neu',
		expectedNextDueAt: '2026-11-01T11:00:00.000Z',
	});
	assert.equal(fresh.status, 200);
	assert.equal(state.template.description, 'Miete neu');
});
