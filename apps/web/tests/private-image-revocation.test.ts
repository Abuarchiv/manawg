import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
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
} from './support/private-image-db';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from './support/route-harness';

// Private image revocation through the flows that remove references (WG and account deletion,
// expense, chat and announcement routes) against a real PostgreSQL schema, including the WG
// lock order these flows share with attachments and announcement replays.

const wgId = '11111111-1111-4111-8111-111111111111';
const routeWgId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const routeMemberId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const accountWgId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// Stored image URLs carry this origin; the chat route only accepts the app's own origin.
process.env.NEXT_PUBLIC_APP_URL = 'https://old-preview.example';
Reflect.deleteProperty(process.env, 'VERCEL_URL');

mockLiveDb();

// The real transaction helpers, with each WG lock attempt observable by the test.
const transaction = await import('../src/core/db/transaction.ts');
const lockObserver = { next: null as (() => void) | null };
mock.module('@/core/db/transaction', {
	namedExports: {
		...transaction,
		lockExpensePayments: (tx: Parameters<typeof transaction.lockExpensePayments>[0], id: string) => {
			const observe = lockObserver.next;
			lockObserver.next = null;
			observe?.();
			return transaction.lockExpensePayments(tx, id);
		},
	},
});

mockObservability();
mockRateLimit();
const member = mockWgMember({
	wg: { id: wgId, name: 'Test WG', shareCode: 'MTE8PZAT' },
	member: { memberId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Member' },
});
mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: { dispatchNotificationSafely: async () => ({ warning: null }) },
});
mock.module('@/core/guards/admin', {
	namedExports: { isWgAdmin: async () => true, requireOwnerOrAdmin: async () => null },
});
// No replay is stored yet; the claim row itself is seeded by the lock-order test.
mock.module('@/core/idempotency-store', {
	namedExports: {
		readIdempotencyKey: (req: Request) => req.headers.get('Idempotency-Key'),
		claimResponseSlot: async () => true,
		getCachedResponse: async () => null,
		setReplayWarning: async () => false,
		purgeExpiredIdempotencyResponses: async () => 0,
	},
});
mock.module('@/features/expenses/expense-payments', {
	namedExports: {
		hasCapturingExpensePayment: async () => false,
		withExpensePaymentLock: async <T>(
			currentWgId: string,
			operation: (tx: Parameters<typeof transaction.lockExpensePayments>[0]) => Promise<T>,
		) =>
			ctx.db.transaction(async (tx) => {
				await transaction.lockExpensePayments(tx, currentWgId);
				return operation(tx);
			}),
	},
});

const helper = await import('../src/core/db/private-image-deletions.ts');
const { deleteWgCascade } = await import('../src/core/db/delete-wg.ts');
const { removeAccountFromWgs } = await import('../src/core/db/delete-account.ts');
const chatMessagesRoute = await import('../src/app/api/wg/[code]/chat/messages/route.ts');
const chatMessageRoute = await import('../src/app/api/wg/[code]/chat/messages/[id]/route.ts');
const expenseRoute = await import('../src/app/api/wg/[code]/expenses/[id]/route.ts');
const announcementRoute = await import('../src/app/api/wg/[code]/announcements/[id]/route.ts');
const { withAnnouncementReplay } = await import('../src/features/pinnwand/announcement-replay.ts');

let ctx: PrivateImageDb;

before(async () => {
	if (connectionString) ctx = await openPrivateImageDb();
});
after(async () => {
	await ctx?.close();
});

function actAs(id: string, memberId: string): void {
	member.wg = { id, name: 'Test WG', shareCode: 'MTE8PZAT' };
	member.member = { memberId, name: 'Member' };
}

test('a chat writer waits for a whole-WG deletion and is refused the removed image', skipWithoutDatabase, async () => {
	const cascadeImage = imageUrl('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', wgId);
	await ctx.setup.query(`INSERT INTO ${ctx.schemaName}.wgs (id) VALUES ($1)`, [wgId]);
	await ctx.setup.query(`INSERT INTO ${ctx.schemaName}.expenses (wg_id, image_url) VALUES ($1, $2)`, [
		wgId,
		cascadeImage.url,
	]);
	const release = deferred();
	const applied = deferred();
	const routeLock = deferred();
	const deletingWg = ctx.db.transaction(async (tx) => {
		assert.equal(await deleteWgCascade(tx, wgId), true);
		applied.resolve();
		await release.promise;
	});
	let post: Promise<Response> | undefined;
	try {
		assert.equal(
			await reachesFirst(applied.promise, deletingWg),
			true,
			'WG deletion transaction reaches its held-lock gate',
		);
		actAs(wgId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
		lockObserver.next = routeLock.resolve;
		post = chatMessagesRoute.POST(
			request('/api/wg/MTE8PZAT/chat/messages', {
				method: 'POST',
				body: { body: 'Race attachment', imageUrl: cascadeImage.url },
			}),
			routeCtx(),
		);
		assert.equal(
			await reachesFirst(routeLock.promise, post),
			true,
			'writer enters its WG transaction before completing',
		);
		assert.notEqual(
			await lockedQuery(ctx.setup),
			null,
			'chat writer waits for whole-WG deletion under the same lock',
		);
		release.resolve();
		await deletingWg;
		const postResponse = await post;
		assert.equal(postResponse.status, 409);
		assert.deepEqual(await postResponse.json(), { error: 'image_removed', code: 'image_removed' });
		assert.equal(await helper.isPrivateImageKeyRevoked(cascadeImage.key), true);
		const remainingImages = await ctx.setup.query<{ count: number }>(
			`SELECT count(*)::int AS count FROM ${ctx.schemaName}.wg_chat_messages WHERE wg_id = $1 AND image_url = $2`,
			[wgId, cascadeImage.url],
		);
		assert.equal(remainingImages.rows[0]?.count, 0);
	} finally {
		lockObserver.next = null;
		release.resolve();
		await deletingWg.catch(() => undefined);
		if (post) await post.catch(() => undefined);
	}
});

test("deleting a WG's last account revokes the WG's images", skipWithoutDatabase, async () => {
	const accountUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
	const accountMemberId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
	const accountImage = imageUrl('cccccccc-cccc-4ccc-8ccc-cccccccccccc', accountWgId);
	await ctx.setup.query(`INSERT INTO ${ctx.schemaName}.wgs (id) VALUES ($1)`, [accountWgId]);
	await ctx.setup.query(
		`INSERT INTO ${ctx.schemaName}.wg_members (id, wg_id, auth_user_id, name, role) VALUES ($1, $2, $3, 'Last Member', 'admin')`,
		[accountMemberId, accountWgId, accountUserId],
	);
	await ctx.setup.query(`INSERT INTO ${ctx.schemaName}.expenses (wg_id, image_url) VALUES ($1, $2)`, [
		accountWgId,
		accountImage.url,
	]);
	const removal = await ctx.db.transaction((tx) => removeAccountFromWgs(tx, accountUserId));
	assert.deepEqual(removal.deletedWgIds, [accountWgId]);
	assert.equal(await helper.isPrivateImageKeyRevoked(accountImage.key), true);
});

test('expense, chat and announcement deletions revoke their last image reference', skipWithoutDatabase, async () => {
	await ctx.setup.query(`INSERT INTO ${ctx.schemaName}.wgs (id) VALUES ($1)`, [routeWgId]);
	actAs(routeWgId, routeMemberId);

	const patchImage = imageUrl('12121212-1212-4212-8212-121212121212', routeWgId);
	const deleteImage = imageUrl('13131313-1313-4313-8313-131313131313', routeWgId);
	const insertExpense = async (url: string) => {
		const inserted = await ctx.setup.query<{ id: string }>(
			`INSERT INTO ${ctx.schemaName}.expenses (wg_id, paid_by_member_id, image_url) VALUES ($1, $2, $3) RETURNING id`,
			[routeWgId, routeMemberId, url],
		);
		return inserted.rows[0]?.id as string;
	};
	const patchExpenseId = await insertExpense(patchImage.url);
	const deleteExpenseId = await insertExpense(deleteImage.url);
	const patchResponse = await expenseRoute.PATCH(
		request('/api/wg/MTE8PZAT/expenses/x', { method: 'PATCH', body: { imageUrl: null } }),
		routeCtx({ id: patchExpenseId }),
	);
	assert.equal(patchResponse.status, 200);
	assert.equal(await helper.isPrivateImageKeyRevoked(patchImage.key), true);
	const deleteResponse = await expenseRoute.DELETE(
		request('/api/wg/MTE8PZAT/expenses/x', { method: 'DELETE' }),
		routeCtx({ id: deleteExpenseId }),
	);
	assert.equal(deleteResponse.status, 200);
	assert.equal(await helper.isPrivateImageKeyRevoked(deleteImage.key), true);

	const chatImage = imageUrl('14141414-1414-4414-8414-141414141414', routeWgId);
	const chatMessageId = '15151515-1515-4515-8515-151515151515';
	await ctx.setup.query(
		`INSERT INTO ${ctx.schemaName}.wg_chat_messages (id, wg_id, sender_member_id, kind, body, image_url) VALUES ($1, $2, $3, 'image', null, $4)`,
		[chatMessageId, routeWgId, routeMemberId, chatImage.url],
	);
	const chatDeleteResponse = await chatMessageRoute.DELETE(
		request('/api/wg/MTE8PZAT/chat/messages/x', { method: 'DELETE' }),
		routeCtx({ id: chatMessageId }),
	);
	assert.equal(chatDeleteResponse.status, 200);
	assert.equal(await helper.isPrivateImageKeyRevoked(chatImage.key), true);

	const announcementImage = imageUrl('16161616-1616-4616-8616-161616161616', routeWgId);
	const announcementId = '17171717-1717-4717-8717-171717171717';
	await ctx.setup.query(
		`INSERT INTO ${ctx.schemaName}.announcements (id, wg_id, author_member_id, content, image_url) VALUES ($1, $2, $3, 'Announcement', $4)`,
		[announcementId, routeWgId, routeMemberId, announcementImage.url],
	);
	const announcementDeleteResponse = await announcementRoute.DELETE(
		request('/api/wg/MTE8PZAT/announcements/x', { method: 'DELETE' }),
		routeCtx({ id: announcementId }),
	);
	assert.equal(announcementDeleteResponse.status, 200);
	assert.equal(await helper.isPrivateImageKeyRevoked(announcementImage.key), true);
});

test('an announcement replay takes the WG lock before the replay-row lock', skipWithoutDatabase, async () => {
	const replayKey = 'announcement-lock-order';
	const replayScope = `announcement:${accountWgId}:member`;
	await ctx.setup.query(
		`INSERT INTO ${ctx.schemaName}.idempotency_responses (scope, key, response_body, expires_at) VALUES ($1, $2, '{"_claimed":true}'::jsonb, $3)`,
		[replayScope, replayKey, new Date(Date.now() + 60_000)],
	);
	const release = deferred();
	const locked = deferred();
	const replayLock = deferred();
	const replayLockHolder = ctx.db.transaction(async (tx) => {
		await transaction.lockExpensePayments(tx, accountWgId);
		locked.resolve();
		await release.promise;
	});
	try {
		assert.equal(
			await reachesFirst(locked.promise, replayLockHolder),
			true,
			'test transaction holds the WG lock',
		);
		let mutateStarted = false;
		lockObserver.next = replayLock.resolve;
		const replay = withAnnouncementReplay(
			new Request('https://app.example', { headers: { 'Idempotency-Key': replayKey } }),
			replayScope,
			async () => {
				mutateStarted = true;
				return {
					response: { status: 200, body: { announcement: { id: 'created' } } },
					effect: null,
				};
			},
			undefined,
			accountWgId,
		);
		assert.equal(
			await reachesFirst(replayLock.promise, replay),
			true,
			'WG lock is attempted before the replay-row lock',
		);
		const waiting = await lockedQuery(ctx.setup);
		assert.match(waiting ?? '', /pg_advisory_xact_lock/);
		assert.equal(mutateStarted, false);
		release.resolve();
		await replayLockHolder;
		assert.equal((await replay).response.status, 200);
	} finally {
		lockObserver.next = null;
		release.resolve();
		await replayLockHolder.catch(() => undefined);
	}
});
