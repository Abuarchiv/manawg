import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const wgId = '1bc67a5a-5c08-4c0d-8eaf-520def98021a';
const fromMemberId = '2bc67a5a-5c08-4c0d-8eaf-520def98021a';
const toMemberId = '3bc67a5a-5c08-4c0d-8eaf-520def98021a';

function loadOrderRoute(overrides) {
	const source = readFileSync('src/app/api/wg/[code]/paypal/order/route.ts', 'utf8');
	const compiled = transpileModule(source, {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const loaded = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (name in overrides ? overrides[name] : requireFromWeb(name)),
		loaded,
		loaded.exports,
	);
	return loaded.exports;
}

test('new PayPal order is refused when the recipient has lost provider readiness', async () => {
	const wgMembers = { id: 'id', wgId: 'wgId' };
	const expensePayments = { id: 'id', status: 'status' };
	const debt = { fromId: fromMemberId, toId: toMemberId, cents: 1_000, currency: 'EUR' };
	const members = [
		{ id: fromMemberId, name: 'Payer', color: 'blue', paypalMerchantId: null },
		{ id: toMemberId, name: 'Payee', color: 'green', paypalMerchantId: '2B23456789ABC' },
	];
	const state = { created: 0, failed: false };
	const tx = {
		select: () => {
			let rows = [];
			const query = Promise.resolve().then(() => rows);
			return Object.assign(query, {
				from(value) {
					rows = value === wgMembers ? members : [];
					return this;
				},
				where() {
					return this;
				},
				limit: async () => [],
			});
		},
		insert: () => ({
			values: () => ({
				onConflictDoNothing: () => ({ returning: async () => [{ id: 'payment-id' }] }),
			}),
		}),
		update: () => ({
			set: (values) => ({
				where: async () => {
					if (values.status === 'failed') state.failed = true;
				},
			}),
		}),
	};
	const z = requireFromWeb('zod').z;
	const overrides = {
		'@/core/db': { expensePayments, wgMembers },
		'@/core/errors': {
			badRequest: (error) => Response.json({ error }, { status: 400 }),
			conflict: (error) => Response.json({ error }, { status: 409 }),
			forbidden: (error) => Response.json({ error }, { status: 403 }),
			requireVerifiedMember: () => null,
			serverError: (error) => Response.json({ error }, { status: 500 }),
			tooMany: () => new Response(null, { status: 429 }),
		},
		'@/core/guards/require-wg-member': {
			requireWgMember: async () => ({
				ok: true,
				wg: { id: wgId },
				member: { memberId: fromMemberId, verified: true },
			}),
		},
		'@/core/guards/with-wg-route': { withWgRoute: (_name, handler) => handler },
		'@/core/infra/observability': { logApiError: () => undefined },
		'@/core/infra/paypal': {
			isPayPalConfigured: () => true,
			createPayPalOrder: async () => {
				state.created += 1;
				return { id: 'order-id' };
			},
		},
		'@/core/infra/paypal-onboarding': { isPayPalMerchantReady: async () => false },
		'@/core/rate-limit': { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
		'@/core/validators/currency': { currencySchema: z.string() },
		'@/features/expenses/debt-reduction': {
			computeNetBalances: () => [],
			simplifyDebts: () => [debt],
		},
		'@/features/expenses/debts': {
			computeBalances: () => [
				{ debtorId: fromMemberId, creditorId: toMemberId, amountCents: 1_000, currency: 'EUR' },
			],
		},
		'@/features/expenses/expense-payments': {
			PAYPAL_ORDER_TTL_MS: 60_000,
			loadCompletedExpensePayments: async () => [],
			withExpensePaymentLock: async (_id, operation) => operation(tx),
		},
		'@/features/expenses/open-expenses': { loadOpenExpenses: async () => [] },
		'drizzle-orm': {
			and: () => null,
			eq: () => null,
			inArray: () => null,
			lte: () => null,
			sql: (parts, ...values) => ({ parts, values }),
		},
		'next/server': { NextResponse: Response },
	};
	const { POST } = loadOrderRoute(overrides);
	const response = await POST(
		new Request('https://manawg.example/api/paypal/order', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fromMemberId, toMemberId, currency: 'EUR' }),
		}),
		{ code: 'MTE8PZAT' },
	);
	assert.equal(response.status, 409);
	assert.equal((await response.json()).error, 'paypal_onboarding_pending');
	assert.equal(state.created, 0);
	assert.equal(state.failed, true);
});
