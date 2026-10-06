import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PgDialect, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { mockDb } from '../../../../../../../tests/support/db-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../../tests/support/route-harness';
import { TransactionAbort } from '../../../../../../core/db/transaction-abort';

// Real drizzle, real claim protocol and the real idempotency store run against an in-memory
// slot; the SQL the store and the claim release send is rendered and inspected.

const key = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const mentionedId = '33333333-3333-4333-8333-333333333333';
const wgId = '44444444-4444-4444-8444-444444444444';

process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
Reflect.deleteProperty(process.env, 'VERCEL_URL');

const idempotencyResponses = pgTable('idempotency_responses', {
	scope: text('scope'),
	key: text('key'),
	responseBody: jsonb('response_body'),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
});
const wgChatMessages = pgTable('wg_chat_messages', {
	id: uuid('id'),
	wgId: uuid('wg_id'),
	deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
const wgChatMentions = pgTable('wg_chat_mentions', {
	mentionedMemberId: uuid('mentioned_member_id'),
});
const wgMembers = pgTable('wg_members', { id: uuid('id'), wgId: uuid('wg_id') });

type Slot = { _claimed?: boolean; body?: { warning?: unknown }; [field: string]: unknown } | null;
type Row = Record<string, unknown>;

const state = {
	slot: null as Slot,
	messages: [] as Row[],
	mentions: [] as Row[],
	claims: 0,
	audits: 0,
	notifications: 0,
	failReplayWrite: false,
	failCommit: false,
	warning: null as string | null,
	warningUpdateSucceeds: true,
	warningWhere: '',
	claimExpiry: new Date(),
	releaseWhere: '',
	locks: 0,
	rejectImageAttachment: false,
	prior: Promise.resolve(),
};

function reset(): void {
	state.slot = null;
	state.messages = [];
	state.mentions = [];
	state.claims = 0;
	state.audits = 0;
	state.notifications = 0;
	state.failReplayWrite = false;
	state.failCommit = false;
	state.warning = null;
	state.warningUpdateSucceeds = true;
	state.warningWhere = '';
	state.claimExpiry = new Date(Date.now() + 15 * 60_000);
	state.releaseWhere = '';
	state.locks = 0;
	state.rejectImageAttachment = false;
	state.prior = Promise.resolve();
	observed.logged = [];
}

const sqlOf = (condition: unknown) => new PgDialect().sqlToQuery(condition as never).sql;

/** Transactions run one at a time and commit their copy of the slot and rows only on success. */
async function withTransaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
	const waitFor = state.prior;
	let release: () => void = () => undefined;
	state.prior = new Promise((resolve) => {
		release = resolve;
	});
	await waitFor;
	let slot = structuredClone(state.slot);
	const messages = [...state.messages];
	const mentions = [...state.mentions];
	const tx = {
		select: () => ({
			from: (table: unknown) => ({
				where: () =>
					table === wgMembers
						? Promise.resolve([{ id: mentionedId }])
						: {
								limit: () =>
									table === idempotencyResponses
										? {
												for: async () =>
													slot ? [{ body: slot, expiresAt: state.claimExpiry }] : [],
											}
										: Promise.resolve([]),
							},
			}),
		}),
		insert: (table: unknown) => ({
			values: (value: Row | Row[]) => ({
				returning: async () => {
					assert.equal(table, wgChatMessages);
					const message = { ...(value as Row), id: `message-${messages.length + 1}` };
					messages.push(message);
					return [message];
				},
				onConflictDoNothing: () => ({
					returning: async () => {
						assert.equal(table, wgChatMentions);
						mentions.push(...(value as Row[]));
						return value;
					},
				}),
			}),
		}),
		update: (table: unknown) => ({
			set: (value: { responseBody: Slot }) => ({
				where: () => ({
					returning: async () => {
						assert.equal(table, idempotencyResponses);
						if (state.failReplayWrite) throw new Error('cache_write_failed');
						if (JSON.stringify(slot) !== '{"_claimed":true}') return [];
						slot = value.responseBody;
						return [{ scope: 'chat-message' }];
					},
				}),
			}),
		}),
	};
	try {
		const result = await operation(tx);
		if (state.failCommit) throw new Error('commit_outcome_unknown');
		state.slot = slot;
		state.messages = messages;
		state.mentions = mentions;
		return result;
	} finally {
		release();
	}
}

const observed = mockObservability();
mockRateLimit();
mockWgMember({
	wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' },
	member: { memberId, name: 'Member' },
});
mockDb({
	idempotencyResponses,
	wgChatMentions,
	wgChatMessages,
	wgMembers,
	withTransaction,
	db: {
		// The store's replay read; a pending placeholder is filtered by the store itself.
		select: () => ({
			from: () => ({
				where: () => ({ limit: async () => (state.slot ? [{ body: state.slot }] : []) }),
			}),
		}),
		delete: () => ({
			where: (condition: unknown) => ({
				returning: async () => {
					state.releaseWhere = sqlOf(condition);
					if (!state.slot?._claimed) return [];
					state.slot = null;
					return [{ scope: 'chat-message' }];
				},
			}),
		}),
		update: () => ({
			set: () => ({
				where: (condition: unknown) => ({
					returning: async () => {
						state.warningWhere = sqlOf(condition);
						if (!state.warningUpdateSucceeds || !state.slot?.body) return [];
						state.slot.body.warning = state.warning;
						return [{ scope: 'chat-message' }];
					},
				}),
			}),
		}),
	},
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort,
		withTransaction,
		lockExpensePayments: async () => {
			state.locks++;
		},
	},
});
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: async () => {
			state.claims++;
			if (!state.slot) state.slot = { _claimed: true };
			return { won: true };
		},
	},
});
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			state.audits++;
		},
	},
});
mock.module('@/core/db/private-image-deletions', {
	namedExports: {
		assertPrivateImageCanBeAttached: async () => {
			if (state.rejectImageAttachment) throw new TransactionAbort('image_removed');
		},
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async () => {
			assert.equal(state.messages.length, 1, 'notification must run after commit');
			state.notifications++;
			return { warning: state.warning };
		},
	},
});

const { POST } = await import('./route');

const post = (imageUrl: string | null = null) =>
	POST(
		request('/api/wg/MTE8PZAT/chat/messages', {
			method: 'POST',
			headers: { 'Idempotency-Key': key },
			body: { body: 'Hello', imageUrl, mentionMemberIds: [mentionedId] },
		}),
		routeCtx(),
	);

/** The route's error boundary answers 500 and logs the error that escaped the write. */
async function assertServerError(response: Response, message: RegExp): Promise<void> {
	assert.equal(response.status, 500);
	assert.deepEqual(await response.json(), { error: 'server_error' });
	const errors = observed.logged.flatMap((entry) => entry.errors);
	assert.ok(
		errors.some((err) => err instanceof Error && message.test(err.message)),
		`expected a logged ${message}`,
	);
}

test('concurrent claimed retries commit one chat message and replay one response', async () => {
	reset();
	const responses = await Promise.all([post(), post()]);
	const bodies = await Promise.all(responses.map((response) => response.json()));
	assert.deepEqual(bodies[0], bodies[1]);
	assert.equal(state.messages.length, 1);
	assert.equal(state.mentions.length, 1);
	assert.equal(state.audits, 1);
	assert.equal(state.notifications, 2);
});

test('failed replay write rolls back message and mentions before a safe retry', async () => {
	reset();
	state.failReplayWrite = true;
	await assertServerError(await post(), /cache_write_failed/);
	assert.equal(state.messages.length, 0);
	assert.equal(state.mentions.length, 0);
	assert.equal(state.notifications, 0);
	assert.match(state.releaseWhere, /expires_at/);
	assert.match(state.releaseWhere, /_claimed/);
	assert.equal(state.slot, null);
	state.failReplayWrite = false;
	assert.equal((await post()).status, 200);
	assert.equal(state.messages.length, 1);
	assert.equal(state.claims, 2);
});

test('malformed claim cannot authorize a chat insert', async () => {
	reset();
	state.slot = { _claimed: true, extra: 1 };
	await assertServerError(await post(), /idempotency_claim_invalid/);
	assert.equal(state.messages.length, 0);
});

test('uncertain COMMIT outcome keeps the claim fail-closed', async () => {
	reset();
	state.failCommit = true;
	await assertServerError(await post(), /commit_outcome_unknown/);
	assert.deepEqual(state.slot, { _claimed: true });
	assert.equal(state.releaseWhere, '');
	assert.equal(state.notifications, 0);
});

test('failed warning enrichment leaves replay base response unchanged', async () => {
	reset();
	state.warning = 'notification_delivery_failed';
	state.warningUpdateSucceeds = false;
	const first = await (await post()).json();
	const replay = await (await post()).json();
	assert.equal(first.warning, null);
	assert.equal(replay.warning, null);
	assert.equal(state.messages.length, 1);
	assert.equal(state.notifications, 2);
	assert.match(state.warningWhere, /expires_at/);
	assert.match(state.warningWhere, /message/);
	assert.match(state.warningWhere, /warning/);
});

test('persisted notification warning is replayed without a second dispatch', async () => {
	reset();
	state.warning = 'notification_delivery_failed';
	const first = await (await post()).json();
	const replay = await (await post()).json();
	assert.equal(first.warning, state.warning);
	assert.equal(replay.warning, state.warning);
	assert.equal(state.messages.length, 1);
	assert.equal(state.notifications, 2);
});

test('revoked private image attachment returns 409 and creates no chat row', async () => {
	reset();
	state.rejectImageAttachment = true;
	const response = await post(
		'https://app.example/api/upload/read?key=manawg%2F44444444-4444-4444-8444-444444444444%2Fannouncement%2F55555555-5555-4555-8555-555555555555.jpg',
	);
	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), { error: 'image_removed', code: 'image_removed' });
	assert.equal(state.messages.length, 0);
	assert.equal(state.notifications, 0);
	assert.ok(state.locks > 0);
});
