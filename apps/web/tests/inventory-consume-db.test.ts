import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as baseSchema from '../src/core/db/schema.ts';
import * as inventorySchema from '../src/core/db/schema-inventory.ts';
import { generateShareCode } from '../src/core/utils/share-code.ts';

// Consuming supplies against real rows: the WG scope of the locked row, the clamp at zero, the
// log entry and the one-time push to the shopping list. Opt-in: TEST_DATABASE_URL must name a
// disposable loopback database with all migrations applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
	process.env.DATABASE_URL = url;
	process.env.POSTGRES_URL = url;
}

const { consumeInventoryMutation } = await import(
	'../src/features/inventory/server/consume-mutation.ts'
);

const schema = { ...baseSchema, ...inventorySchema };
const pool = new pg.Pool({ connectionString: url || undefined, max: 2 });
const database = drizzle(pool, { schema });
const wgIds: string[] = [];
after(async () => {
	if (wgIds.length > 0) await database.delete(schema.wgs).where(inArray(schema.wgs.id, wgIds));
	await pool.end();
});

async function flatWithItem(quantity: number, threshold: number) {
	const [wg] = await database
		.insert(schema.wgs)
		.values({ shareCode: generateShareCode(), name: `Supplies ${randomUUID()}` })
		.returning({ id: schema.wgs.id });
	assert.ok(wg);
	wgIds.push(wg.id);
	const [member] = await database
		.insert(schema.wgMembers)
		.values({ wgId: wg.id, name: 'Anna', authUserId: randomUUID() })
		.returning({ id: schema.wgMembers.id });
	assert.ok(member);
	const [item] = await database
		.insert(schema.wgInventoryItems)
		.values({ wgId: wg.id, name: 'Klopapier', quantity, threshold, unit: 'roll' })
		.returning({ id: schema.wgInventoryItems.id });
	assert.ok(item);
	return { wgId: wg.id, memberId: member.id, itemId: item.id };
}

const consume = (flat: { wgId: string; memberId: string; itemId: string }, delta: number) =>
	database.transaction((tx) =>
		consumeInventoryMutation(tx as never, { ...flat, delta, locale: 'de' }),
	);
const logDeltas = async (itemId: string) =>
	(
		await database
			.select({ delta: schema.wgInventoryLog.delta })
			.from(schema.wgInventoryLog)
			.where(eq(schema.wgInventoryLog.itemId, itemId))
	).map((row) => Number(row.delta));
const shoppingNames = async (wgId: string) =>
	(
		await database
			.select({ name: schema.shoppingItems.name })
			.from(schema.shoppingItems)
			.where(eq(schema.shoppingItems.wgId, wgId))
	).map((row) => row.name);

test('an item of another flat is not found and stays as it was', { skip }, async () => {
	const flat = await flatWithItem(5, 1);
	const other = await flatWithItem(5, 1);
	const result = await consume({ ...flat, itemId: other.itemId }, -1);
	assert.equal(result.kind, 'not_found');
	const [row] = await database
		.select({ quantity: schema.wgInventoryItems.quantity })
		.from(schema.wgInventoryItems)
		.where(eq(schema.wgInventoryItems.id, other.itemId));
	assert.equal(Number(row?.quantity), 5);
	assert.deepEqual(await logDeltas(other.itemId), []);
});

test('consuming more than is left stops at zero and logs what was taken', { skip }, async () => {
	const flat = await flatWithItem(1, 0);
	const result = await consume(flat, -3);
	assert.equal(result.kind, 'ok');
	assert.ok(result.kind === 'ok');
	assert.equal(Number(result.updated.quantity), 0);
	assert.equal(result.appliedDelta, -1);
	assert.equal(result.clamped, true);
	assert.deepEqual(await logDeltas(flat.itemId), [-1]);
	// Nothing left to take: no log entry for a tap that changed nothing.
	const empty = await consume(flat, -1);
	assert.ok(empty.kind === 'ok');
	assert.equal(empty.appliedDelta, 0);
	// The last use stays the real one, so "used recently" does not count empty taps.
	assert.deepEqual(empty.updated.lastDecrementedAt, result.updated.lastDecrementedAt);
	assert.deepEqual(await logDeltas(flat.itemId), [-1]);
});

test('the item goes on the shopping list once, when it falls to its threshold', {
	skip,
}, async () => {
	const flat = await flatWithItem(4, 2);
	const above = await consume(flat, -1);
	assert.ok(above.kind === 'ok');
	assert.equal(above.justCrossedThreshold, false);
	assert.deepEqual(await shoppingNames(flat.wgId), []);

	const crossing = await consume(flat, -1);
	assert.ok(crossing.kind === 'ok');
	assert.equal(crossing.justCrossedThreshold, true);
	assert.ok(crossing.autoPushedShoppingItemId);
	assert.deepEqual(await shoppingNames(flat.wgId), ['Klopapier']);

	const further = await consume(flat, -1);
	assert.ok(further.kind === 'ok');
	assert.equal(further.justCrossedThreshold, false);
	assert.equal(further.autoPushedShoppingItemId, null);
	assert.deepEqual(await shoppingNames(flat.wgId), ['Klopapier']);
});
