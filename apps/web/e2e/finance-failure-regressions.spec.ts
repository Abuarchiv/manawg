import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import * as schema from '../src/core/db/schema';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));

function loadTs<T>(file: string, overrides: Record<string, unknown>): T {
	const code = transpileModule(readFileSync(path.join(process.cwd(), 'src', file), 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} as T };
	new Function('require', 'module', 'exports', code)(
		(name: string) => (Object.hasOwn(overrides, name) ? overrides[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	return module.exports;
}

function query(result: Promise<unknown>): unknown {
	const chain: unknown = new Proxy(
		{},
		{
			get: (_target, key) => {
				if (key === 'then') return result.then.bind(result);
				if (key === 'catch') return result.catch.bind(result);
				return () => chain;
			},
		},
	);
	return chain;
}

for (const table of ['wgMembers', 'expenses', 'expenseSplits', 'expensePayments'] as const) {
	test(`dashboard refuses incomplete financial data when ${table} fails`, async () => {
		const failure = new Error(`${table} unavailable`);
		const { loadDashboardData } = loadTs<{
			loadDashboardData: (wgId: string) => Promise<unknown>;
		}>('core/reads/dashboard-data.ts', {
			'@/core/db': {
				...schema,
				db: {
					select: () => ({
						from: (selected: unknown) =>
							query(selected === schema[table] ? Promise.reject(failure) : Promise.resolve([])),
					}),
				},
			},
			'@/core/infra/observability': { captureException: () => undefined },
			'@/core/utils/berlin-day': {},
			'@/features/chores/absence': {},
			'@/features/expenses/debt-reduction': { computeNetBalances: () => [] },
			'@/features/expenses/recurring-expenses': {},
			'./activity': {},
			'./dashboard-insights': {},
			'./dashboard-links': {},
		});
		await expect(loadDashboardData('wg')).rejects.toBe(failure);
	});
}

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const DEPARTED_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';

async function patchWithDepartedMember(body: Record<string, unknown>, paused = false) {
	const template = {
		id: TEMPLATE_ID,
		wgId: 'wg',
		createdByMemberId: MEMBER_ID,
		paidByMemberId: MEMBER_ID,
		description: 'Internet',
		amountCents: 1000,
		intervalMonths: 1,
		nextDueAt: new Date(),
		createdAt: new Date(),
		lastCreatedAt: null,
		pausedAt: paused ? new Date() : null,
		splitsJson: JSON.stringify([{ debtorMemberId: DEPARTED_ID, amountCents: 1000 }]),
	};
	let writes = 0;
	const dialect = new PgDialect();
	const { PATCH } = loadTs<{
		PATCH: (req: Request, params: { code: string; id: string }) => Promise<Response>;
	}>('app/api/wg/[code]/recurring-expenses/[id]/route.ts', {
		'@/core/audit': { recordAuditEvent: async () => undefined },
		'@/core/db': {
			...schema,
			db: {
				select: () => ({
					from: (table: unknown) => ({
						where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
							if (table === schema.recurringExpenses) return query(Promise.resolve([template]));
							const activeOnly = dialect
								.sqlToQuery(condition)
								.sql.includes('"deactivated_at" is null');
							return query(
								Promise.resolve(
									activeOnly ? [{ id: MEMBER_ID }] : [{ id: MEMBER_ID }, { id: DEPARTED_ID }],
								),
							);
						},
					}),
				}),
				update: () => ({
					set: (values: Record<string, unknown>) => ({
						where: () => ({
							returning: async () => {
								writes += 1;
								return [{ ...template, ...values }];
							},
						}),
					}),
				}),
			},
		},
		'@/core/errors': {
			badRequest: (error: string) => Response.json({ error }, { status: 400 }),
			apiError: (error: string, status: number) => Response.json({ error }, { status }),
		},
		'@/core/guards/admin': { requireOwnerOrAdmin: async () => null },
		'@/core/guards/api-auth': { UUID_PATTERN: /^[0-9a-f-]{36}$/ },
		'@/core/guards/require-wg-member': {
			requireWgMember: async () => ({
				ok: true,
				wg: { id: 'wg' },
				member: { memberId: MEMBER_ID, name: 'Anna' },
			}),
		},
		'@/core/guards/with-wg-route': { withWgRoute: (_label: string, handler: unknown) => handler },
		'@/core/rate-limit': { checkRateLimit: async () => ({ success: true }) },
		'@/core/validators/currency': { currencySchema: requireFromWeb('zod').z.string() },
		'@/features/expenses/expenses': { checkPaidByGuard: () => ({ ok: true }) },
		'@/features/expenses/recurring-expenses': {
			parseRecurringSplits: JSON.parse,
			recurringSplitsMatchAmount: () => true,
		},
	});
	const response = await PATCH(
		new Request('http://localhost', {
			method: 'PATCH',
			body: JSON.stringify(body),
		}),
		{ code: 'code', id: TEMPLATE_ID },
	);
	return { response, writes };
}

test('an existing subscription can be paused after a participant leaves', async () => {
	const { response, writes } = await patchWithDepartedMember({ paused: true });
	expect(response.status).toBe(200);
	expect((await response.json()).recurringExpense.pausedAt).not.toBeNull();
	expect(writes).toBe(1);
});

test('inactive participants still block resuming and changing finances', async () => {
	for (const body of [{ paused: false }, { amountCents: 2000 }]) {
		const { response, writes } = await patchWithDepartedMember(body, true);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'member_not_in_wg' });
		expect(writes).toBe(0);
	}
});
