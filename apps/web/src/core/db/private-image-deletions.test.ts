import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import {
	type PrivateImageDb,
	connectionString,
	deferred,
	imageUrl,
	lockedQuery,
	mockLiveDb,
	openPrivateImageDb,
	reachesFirst,
	skipWithoutDatabase,
} from '../../../tests/support/private-image-db';
import { TransactionAbort } from './transaction-abort';

// The deletion helpers against a real PostgreSQL schema: references across tables, rollbacks,
// the WG lock that serializes attachment against the last removal, and the cleanup queue.

const wgId = '11111111-1111-4111-8111-111111111111';

mockLiveDb();
const helper = await import('./private-image-deletions');
const { lockExpensePayments } = await import('./transaction');
const { announcements, expenses, wgChatMessages } = await import('./schema');

let ctx: PrivateImageDb;

before(async () => {
	if (connectionString) ctx = await openPrivateImageDb();
});
after(async () => {
	await ctx?.close();
});

const image = (id: string) => imageUrl(id, wgId);

function insertReference(table: string, url: string, deletedAt: Date | null = null) {
	if (table === 'wg_chat_messages') {
		return ctx.setup.query(
			`INSERT INTO ${ctx.schemaName}.${table} (wg_id, image_url, deleted_at) VALUES ($1, $2, $3)`,
			[wgId, url, deletedAt],
		);
	}
	return ctx.setup.query(
		`INSERT INTO ${ctx.schemaName}.${table} (wg_id, image_url) VALUES ($1, $2)`,
		[wgId, url],
	);
}

/** Delete the expense referencing `url` and revoke the image if that was the last reference. */
const deleteExpenseReference = (url: string) =>
	ctx.db.transaction(async (tx) => {
		await lockExpensePayments(tx, wgId);
		await tx.delete(expenses).where(and(eq(expenses.wgId, wgId), eq(expenses.imageUrl, url)));
		await helper.revokePrivateImageIfUnreferenced(tx, wgId, url);
	});

const isImageRemoved = (error: unknown) =>
	error instanceof TransactionAbort && error.code === 'image_removed';

test(
	'a rolled-back deletion leaves the reference and no tombstone',
	skipWithoutDatabase,
	async () => {
		const rollbackImage = image('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
		await insertReference('expenses', rollbackImage.url);
		await assert.rejects(
			ctx.db.transaction(async (tx) => {
				await lockExpensePayments(tx, wgId);
				await tx
					.delete(expenses)
					.where(and(eq(expenses.wgId, wgId), eq(expenses.imageUrl, rollbackImage.url)));
				await helper.revokePrivateImageIfUnreferenced(tx, wgId, rollbackImage.url);
				throw new Error('injected_failure_after_private_image_revocation');
			}),
			(error: Error) => error.message === 'injected_failure_after_private_image_revocation',
		);
		assert.equal(await helper.isPrivateImageKeyRevoked(rollbackImage.key), false);
		const rollbackReference = await ctx.setup.query(
			`SELECT id FROM ${ctx.schemaName}.expenses WHERE wg_id = $1 AND image_url = $2`,
			[wgId, rollbackImage.url],
		);
		assert.equal(
			rollbackReference.rowCount,
			1,
			'the expense reference rolls back with its deletion',
		);
		const rollbackTombstone = await ctx.setup.query(
			`SELECT object_key FROM ${ctx.schemaName}.private_image_deletions WHERE object_key = $1`,
			[rollbackImage.key],
		);
		assert.equal(
			rollbackTombstone.rowCount,
			0,
			'the tombstone insert rolls back with the mutation',
		);
	},
);

test(
	'an image shared with an announcement or a chat message survives until its last reference goes',
	skipWithoutDatabase,
	async () => {
		const sharedAnnouncement = image('33333333-3333-4333-8333-333333333333');
		await insertReference('expenses', sharedAnnouncement.url);
		await insertReference('announcements', sharedAnnouncement.url);
		assert.deepEqual(
			[...(await helper.findLivePrivateImageReferenceKeys([sharedAnnouncement.key]))],
			[sharedAnnouncement.key],
		);
		await deleteExpenseReference(sharedAnnouncement.url);
		assert.equal(await helper.isPrivateImageKeyRevoked(sharedAnnouncement.key), false);
		await ctx.db.transaction(async (tx) => {
			await lockExpensePayments(tx, wgId);
			await tx
				.delete(announcements)
				.where(
					and(eq(announcements.wgId, wgId), eq(announcements.imageUrl, sharedAnnouncement.url)),
				);
			await helper.revokePrivateImageIfUnreferenced(tx, wgId, sharedAnnouncement.url);
		});
		assert.equal(await helper.isPrivateImageKeyRevoked(sharedAnnouncement.key), true);
		await assert.rejects(
			ctx.db.transaction((tx) =>
				helper.assertPrivateImageCanBeAttached(tx, wgId, sharedAnnouncement.url),
			),
			isImageRemoved,
		);

		const sharedChat = image('44444444-4444-4444-8444-444444444444');
		await insertReference('expenses', sharedChat.url);
		await insertReference('wg_chat_messages', sharedChat.url);
		await deleteExpenseReference(sharedChat.url);
		assert.equal(await helper.isPrivateImageKeyRevoked(sharedChat.key), false);
		await ctx.db.transaction(async (tx) => {
			await lockExpensePayments(tx, wgId);
			await tx
				.update(wgChatMessages)
				.set({ deletedAt: new Date() })
				.where(eq(wgChatMessages.imageUrl, sharedChat.url));
			await helper.revokePrivateImageIfUnreferenced(tx, wgId, sharedChat.url);
		});
		assert.equal(await helper.isPrivateImageKeyRevoked(sharedChat.key), true);
	},
);

test(
	'an attachment waiting for an open last-reference deletion is refused',
	skipWithoutDatabase,
	async () => {
		const raced = image('55555555-5555-4555-8555-555555555555');
		await insertReference('expenses', raced.url);
		const release = deferred();
		const changed = deferred();
		const deleting = ctx.db.transaction(async (tx) => {
			await lockExpensePayments(tx, wgId);
			await tx
				.delete(expenses)
				.where(and(eq(expenses.wgId, wgId), eq(expenses.imageUrl, raced.url)));
			await helper.revokePrivateImageIfUnreferenced(tx, wgId, raced.url);
			changed.resolve();
			await release.promise;
		});
		let attaching: Promise<unknown> | undefined;
		try {
			assert.equal(
				await reachesFirst(changed.promise, deleting),
				true,
				'deletion transaction reaches its held-lock gate',
			);
			const started = deferred();
			attaching = ctx.db.transaction(async (tx) => {
				started.resolve();
				await lockExpensePayments(tx, wgId);
				await helper.assertPrivateImageCanBeAttached(tx, wgId, raced.url);
				await tx.execute(
					sql`INSERT INTO expenses (wg_id, image_url) VALUES (${wgId}, ${raced.url})`,
				);
			});
			assert.equal(
				await reachesFirst(started.promise, attaching),
				true,
				'attachment attempts its WG lock while deletion is open',
			);
			release.resolve();
			await deleting;
			await assert.rejects(attaching, isImageRemoved);
			assert.equal(await helper.isPrivateImageKeyRevoked(raced.key), true);
		} finally {
			release.resolve();
			await Promise.allSettled([deleting, ...(attaching ? [attaching] : [])]);
		}
	},
);

test(
	'a last-reference deletion waits for an open attachment and keeps the image',
	skipWithoutDatabase,
	async () => {
		const attachFirst = image('77777777-7777-4777-8777-777777777777');
		const original = await ctx.setup.query<{ id: string }>(
			`INSERT INTO ${ctx.schemaName}.expenses (wg_id, image_url) VALUES ($1, $2) RETURNING id`,
			[wgId, attachFirst.url],
		);
		const originalId = original.rows[0]?.id as string;
		const release = deferred();
		const held = deferred();
		const deletionStarted = deferred();
		const attachingFirst = ctx.db.transaction(async (tx) => {
			await lockExpensePayments(tx, wgId);
			await helper.assertPrivateImageCanBeAttached(tx, wgId, attachFirst.url);
			await tx.execute(
				sql`INSERT INTO expenses (wg_id, image_url) VALUES (${wgId}, ${attachFirst.url})`,
			);
			held.resolve();
			await release.promise;
		});
		let deletingAfterAttach: Promise<unknown> | undefined;
		try {
			assert.equal(
				await reachesFirst(held.promise, attachingFirst),
				true,
				'attachment transaction reaches its held-lock gate',
			);
			deletingAfterAttach = ctx.db.transaction(async (tx) => {
				deletionStarted.resolve();
				await lockExpensePayments(tx, wgId);
				await tx.delete(expenses).where(eq(expenses.id, originalId));
				await helper.revokePrivateImageIfUnreferenced(tx, wgId, attachFirst.url);
			});
			await deletionStarted.promise;
			assert.notEqual(
				await lockedQuery(ctx.setup),
				null,
				'last-reference deletion waits for the attachment lock',
			);
			release.resolve();
			await Promise.all([attachingFirst, deletingAfterAttach]);
			assert.equal(await helper.isPrivateImageKeyRevoked(attachFirst.key), false);
		} finally {
			release.resolve();
			await Promise.allSettled([
				attachingFirst,
				...(deletingAfterAttach ? [deletingAfterAttach] : []),
			]);
		}
	},
);

test(
	'a draft image attaches freely and a WG-wide deletion revokes deleted chat images',
	skipWithoutDatabase,
	async () => {
		const draft = image('66666666-6666-4666-8666-666666666666');
		await ctx.db.transaction((tx) => helper.assertPrivateImageCanBeAttached(tx, wgId, draft.url));

		const deletedChat = image('88888888-8888-4888-8888-888888888888');
		await insertReference('wg_chat_messages', deletedChat.url, new Date());
		await ctx.db.transaction(async (tx) => {
			await lockExpensePayments(tx, wgId);
			await helper.recordWgImageDeletions(tx, wgId);
		});
		assert.equal(await helper.isPrivateImageKeyRevoked(deletedChat.key), true);
	},
);

test(
	'the cleanup queue claims due work in batches, oldest unattempted first, and rechecks after a day',
	skipWithoutDatabase,
	async () => {
		const cleanupNow = new Date();
		const dueKeys = Array.from(
			{ length: 51 },
			(_, index) =>
				`manawg/${wgId}/expense/99999999-9999-4999-9999-${index.toString(16).padStart(12, '0')}.jpg`,
		);
		const values = dueKeys.flatMap((objectKey, index) => [
			objectKey,
			new Date(cleanupNow.getTime() - 2 * 60 * 60 * 1000 - 6 * 60 * 1000 - index),
		]);
		const placeholders = dueKeys
			.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`)
			.join(', ');
		await ctx.setup.query(
			`INSERT INTO ${ctx.schemaName}.private_image_deletions (object_key, requested_at) VALUES ${placeholders}`,
			values,
		);
		const tooEarlyKey = image('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').key;
		await ctx.setup.query(
			`INSERT INTO ${ctx.schemaName}.private_image_deletions (object_key, requested_at) VALUES ($1, $2)`,
			[tooEarlyKey, new Date(cleanupNow.getTime() - 2 * 60 * 60 * 1000 - 4 * 60 * 1000)],
		);
		const pendingBefore = await helper.countPendingPrivateImageDeletions();
		const firstBatch = await helper.claimPrivateImageCleanupBatch(cleanupNow);
		assert.equal(firstBatch.length, 50);
		assert.equal(firstBatch.includes(tooEarlyKey), false);
		const attemptState = await ctx.setup.query<{ unattempted: number }>(
			`SELECT count(*) FILTER (WHERE last_attempt_at IS NULL)::int AS unattempted FROM ${ctx.schemaName}.private_image_deletions WHERE object_key = ANY($1::text[])`,
			[dueKeys],
		);
		assert.equal(attemptState.rows[0]?.unattempted, 1);
		const secondBatch = await helper.claimPrivateImageCleanupBatch(cleanupNow);
		assert.equal(secondBatch.length, 50);
		assert.equal(secondBatch[0], dueKeys[0], 'never-attempted work stays ahead of recent retries');
		await helper.markPrivateImageStorageDeleted([...firstBatch, ...secondBatch], cleanupNow);
		assert.equal(await helper.countPendingPrivateImageDeletions(), pendingBefore - 51);
		const beforeRecheck = await helper.claimPrivateImageCleanupBatch(
			new Date(cleanupNow.getTime() + 24 * 60 * 60 * 1000 - 1),
		);
		assert.equal(
			beforeRecheck.some((key) => dueKeys.includes(key)),
			false,
		);
		const recheck = await helper.claimPrivateImageCleanupBatch(
			new Date(cleanupNow.getTime() + 24 * 60 * 60 * 1000),
		);
		assert.equal(recheck.length, 50);
		assert.equal(
			recheck.every((key) => dueKeys.includes(key)),
			true,
		);
	},
);
