import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { NextRequest } from 'next/server';
import pg from 'pg';
import * as schema from '../src/core/db/schema.ts';
import { generateShareCode } from '../src/core/utils/share-code.ts';

// PATCH and DELETE of one expense against a real PostgreSQL: the SQL itself decides which debtors
// count as active members of the flat and which shares count as settled money. Opt-in like
// wg-member-routes.test.ts.
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
}

mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async (req: Request) => ({
			id: req.headers.get('x-test-user'),
			email: null,
		}),
		createSupabaseServerClient: () => {
			throw new Error('createSupabaseServerClient must not run');
		},
	},
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => '127.0.0.1',
		wgWriteLimiter: {},
		wgShareCodeMissLimiter: {},
	},
});

const dispatched: Array<Record<string, unknown>> = [];
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async (input: Record<string, unknown>) => {
			dispatched.push(input);
			return { sent: 0, warning: null };
		},
	},
});

function dispatchedPayload(): Record<string, number> {
	return (dispatched[0]?.payload ?? {}) as Record<string, number>;
}

async function withExpense(
	run: (f: {
		database: ReturnType<typeof drizzle<typeof schema>>;
		payer: { id: string; userId: string };
		debtor: { id: string; userId: string };
		stranger: { id: string };
		wgId: string;
		otherWgId: string;
		expenseId: string;
		patch: (body: Record<string, unknown>) => Promise<Response>;
		del: (user: string) => Promise<Response>;
		splits: () => Promise<
			Array<{ debtorMemberId: string; amountCents: number; settledAt: Date | null }>
		>;
	}) => Promise<void>,
) {
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_URL = url;
	const route = await import('../src/app/api/wg/[code]/expenses/[id]/route.ts');
	const pool = new pg.Pool({ connectionString: url, max: 2 });
	const database = drizzle(pool, { schema });
	const wgIds: string[] = [];
	try {
		const seedWg = async (label: string) => {
			const code = generateShareCode();
			const [wg] = await database
				.insert(schema.wgs)
				.values({ shareCode: code, name: `Exp ${label} ${randomUUID()}` })
				.returning({ id: schema.wgs.id });
			assert.ok(wg);
			wgIds.push(wg.id);
			const seed = async (name: string) => {
				const userId = randomUUID();
				const [m] = await database
					.insert(schema.wgMembers)
					.values({ wgId: wg.id, name, authUserId: userId })
					.returning({ id: schema.wgMembers.id });
				assert.ok(m);
				return { id: m.id, userId };
			};
			return { id: wg.id, code, payer: await seed('Payer'), debtor: await seed('Debtor') };
		};
		const flat = await seedWg('A');
		const other = await seedWg('B');
		const [expense] = await database
			.insert(schema.expenses)
			.values({
				wgId: flat.id,
				paidByMemberId: flat.payer.id,
				amountCents: 1000,
				description: 'Rent',
			})
			.returning();
		assert.ok(expense);
		await database.insert(schema.expenseSplits).values([
			{
				expenseId: expense.id,
				debtorMemberId: flat.payer.id,
				amountCents: 500,
				settledAt: new Date(),
			},
			{ expenseId: expense.id, debtorMemberId: flat.debtor.id, amountCents: 500 },
		]);
		const request = (user: string, method: string, body?: Record<string, unknown>) =>
			new NextRequest(`http://localhost/api/wg/${flat.code}/expenses/${expense.id}`, {
				method,
				headers: { 'content-type': 'application/json', 'x-test-user': user },
				body: body ? JSON.stringify(body) : null,
			});
		const ctx = { params: Promise.resolve({ code: flat.code, id: expense.id }) };
		await run({
			database,
			payer: flat.payer,
			debtor: flat.debtor,
			stranger: other.payer,
			wgId: flat.id,
			otherWgId: other.id,
			expenseId: expense.id,
			patch: (body) => route.PATCH(request(flat.payer.userId, 'PATCH', body), ctx),
			del: (user) => route.DELETE(request(user, 'DELETE'), ctx),
			splits: () =>
				database
					.select({
						debtorMemberId: schema.expenseSplits.debtorMemberId,
						amountCents: schema.expenseSplits.amountCents,
						settledAt: schema.expenseSplits.settledAt,
					})
					.from(schema.expenseSplits)
					.where(eq(schema.expenseSplits.expenseId, expense.id)),
		});
	} finally {
		for (const id of wgIds) await database.delete(schema.wgs).where(eq(schema.wgs.id, id));
		await pool.end();
	}
}

test('editing splits to a debtor of another flat answers member_not_in_wg', { skip }, async () => {
	await withExpense(async ({ patch, payer, stranger, splits }) => {
		const response = await patch({
			amountCents: 1000,
			splits: [
				{ debtorMemberId: payer.id, amountCents: 500 },
				{ debtorMemberId: stranger.id, amountCents: 500 },
			],
		});
		assert.equal(response.status, 400);
		assert.equal(((await response.json()) as { error: string }).error, 'member_not_in_wg');
		assert.equal((await splits()).length, 2);
	});
});

test("the payer's own share stays settled after an amount edit", { skip }, async () => {
	await withExpense(async ({ patch, payer, debtor, splits }) => {
		const response = await patch({
			amountCents: 1000,
			splits: [
				{ debtorMemberId: payer.id, amountCents: 400 },
				{ debtorMemberId: debtor.id, amountCents: 600 },
			],
		});
		assert.equal(response.status, 200);
		const rows = await splits();
		assert.notEqual(rows.find((s) => s.debtorMemberId === payer.id)?.settledAt, null);
		assert.equal(rows.find((s) => s.debtorMemberId === debtor.id)?.settledAt, null);
	});
});

test('only an edit of amount, share or date tells the debtor; delete tells them their balance', {
	skip,
}, async () => {
	await withExpense(async ({ patch, del, payer, debtor }) => {
		dispatched.length = 0;
		assert.equal((await patch({ category: 'groceries', description: 'Rent, March' })).status, 200);
		assert.equal(dispatched.length, 0);

		assert.equal(
			(
				await patch({
					amountCents: 1200,
					splits: [
						{ debtorMemberId: payer.id, amountCents: 600 },
						{ debtorMemberId: debtor.id, amountCents: 600 },
					],
				})
			).status,
			200,
		);
		assert.equal(dispatched.length, 1);
		assert.equal(dispatched[0]?.event, 'expense.updated');
		assert.deepEqual(dispatched[0]?.targetMemberIds, [debtor.id]);
		const edit = dispatchedPayload();
		assert.deepEqual([edit.shareFromCents, edit.shareToCents], [500, 600]);

		dispatched.length = 0;
		assert.equal((await del(payer.userId)).status, 200);
		assert.equal(dispatched.length, 1);
		assert.equal(dispatched[0]?.event, 'expense.deleted');
		assert.deepEqual(dispatched[0]?.targetMemberIds, [debtor.id]);
		assert.equal(dispatchedPayload().amountCents, 600);
	});
});

test("delete ignores the payer's settled own share but is refused once a debtor has paid", {
	skip,
}, async () => {
	await withExpense(async ({ del, payer, debtor, database, expenseId }) => {
		await database
			.update(schema.expenseSplits)
			.set({ settledAt: new Date() })
			.where(eq(schema.expenseSplits.debtorMemberId, debtor.id));
		assert.equal((await del(payer.userId)).status, 409);
		await database
			.update(schema.expenseSplits)
			.set({ settledAt: null })
			.where(eq(schema.expenseSplits.debtorMemberId, debtor.id));
		assert.equal((await del(debtor.userId)).status, 200);
		assert.equal(
			(await database.select().from(schema.expenses).where(eq(schema.expenses.id, expenseId)))
				.length,
			0,
		);
	});
});

const imageUrlFor = (wgId: string) =>
	`https://app.example/api/upload/read?key=${encodeURIComponent(
		`manawg/${wgId}/expense/${randomUUID()}.jpg`,
	)}`;

test('PATCH refuses a receipt of another flat and a receipt already queued for deletion', {
	skip,
}, async () => {
	const previous = {
		app: process.env.NEXT_PUBLIC_APP_URL,
		vercel: process.env.VERCEL_URL,
		env: process.env.VERCEL_ENV,
	};
	process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
	delete process.env.VERCEL_URL;
	process.env.VERCEL_ENV = 'production';
	try {
		await withExpense(async ({ patch, database, wgId, otherWgId, expenseId }) => {
			const foreign = await patch({ imageUrl: imageUrlFor(otherWgId) });
			assert.equal(foreign.status, 400);
			assert.equal(((await foreign.json()) as { error: string }).error, 'image_invalid');

			const queuedUrl = imageUrlFor(wgId);
			const queuedKey = new URL(queuedUrl).searchParams.get('key') ?? '';
			await database.insert(schema.privateImageDeletions).values({ objectKey: queuedKey });
			try {
				const revoked = await patch({ imageUrl: queuedUrl });
				assert.equal(revoked.status, 409);
				assert.equal(((await revoked.json()) as { error: string }).error, 'image_removed');
			} finally {
				await database
					.delete(schema.privateImageDeletions)
					.where(eq(schema.privateImageDeletions.objectKey, queuedKey));
			}

			const own = await patch({ imageUrl: imageUrlFor(wgId) });
			assert.equal(own.status, 200);
			const [row] = await database
				.select({ imageUrl: schema.expenses.imageUrl })
				.from(schema.expenses)
				.where(eq(schema.expenses.id, expenseId));
			assert.match(row?.imageUrl ?? '', new RegExp(`manawg%2F${wgId}%2Fexpense%2F`));
		});
	} finally {
		for (const [key, value] of [
			['NEXT_PUBLIC_APP_URL', previous.app],
			['VERCEL_URL', previous.vercel],
			['VERCEL_ENV', previous.env],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
