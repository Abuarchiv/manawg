import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { jsonb, PgDialect, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TransactionAbort } from '@/core/db/transaction-abort';

const key = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const mentionedId = '33333333-3333-4333-8333-333333333333';
const wgId = '44444444-4444-4444-8444-444444444444';

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
	createdAt: timestamp('created_at', { withTimezone: true }),
});
const wgChatReads = pgTable('wg_chat_reads', {
	wgId: uuid('wg_id'),
	memberId: uuid('member_id'),
	lastReadMessageId: uuid('last_read_message_id'),
});
const wgChatMentions = pgTable('wg_chat_mentions', {
	mentionedMemberId: uuid('mentioned_member_id'),
});
const wgMembers = pgTable('wg_members', {
	id: uuid('id'),
	wgId: uuid('wg_id'),
	deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
});

type Json = Record<string, unknown>;

const state = {
	slot: null as Json | null,
	messages: [] as Json[],
	mentions: [] as unknown[],
	claims: 0,
	audits: 0,
	notifications: 0,
	failReplayWrite: false,
	failCommit: false,
	warning: null as string | null,
	warningUpdateSucceeds: true,
	warningWhere: '',
	claimExpiry: new Date(Date.now() + 15 * 60_000),
	releaseWhere: '',
	errors: [] as string[],
	locks: 0,
	readMarkerRows: [] as Json[],
	readMarkerQueries: 0,
	insertedCreatedAt: undefined as unknown,
	senderActive: true,
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
	state.errors = [];
	state.locks = 0;
	state.readMarkerRows = [];
	state.readMarkerQueries = 0;
	state.senderActive = true;
}

let prior = Promise.resolve();
const db = {
	select: () => ({
		from: (table: unknown) =>
			table === wgChatReads
				? {
						innerJoin: () => ({
							where: () => ({
								limit: async () => {
									state.readMarkerQueries++;
									return state.readMarkerRows;
								},
							}),
						}),
					}
				: { where: () => ({ orderBy: () => ({ limit: async () => [] }) }) },
	}),
	delete: () => ({
		where: (condition: never) => ({
			returning: async () => {
				state.releaseWhere = new PgDialect().sqlToQuery(condition).sql;
				if (!state.slot?._claimed) return [];
				state.slot = null;
				return [{ scope: 'chat-message' }];
			},
		}),
	}),
	update: () => ({
		set: () => ({
			where: (condition: never) => ({
				returning: async () => {
					state.warningWhere = new PgDialect().sqlToQuery(condition).sql;
					if (!state.warningUpdateSucceeds) return [];
					(state.slot as { body: Json }).body.warning = state.warning;
					return [{ scope: 'chat-message' }];
				},
			}),
		}),
	}),
};
const withTransaction = async <R>(operation: (tx: unknown) => Promise<R>): Promise<R> => {
	const waitFor = prior;
	let release = () => {};
	prior = new Promise<void>((resolve) => {
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
						? Object.assign(Promise.resolve([{ id: mentionedId }]), {
								// The sender's active-member re-check under the lock.
								limit: () => ({ for: async () => (state.senderActive ? [{ id: memberId }] : []) }),
							})
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
			values: (value: Json | unknown[]) => ({
				returning: async () => {
					assert.equal(table, wgChatMessages);
					// The database resolves the `clock_timestamp()` expression; keep what the route sent.
					state.insertedCreatedAt = (value as Json).createdAt;
					const message = {
						...(value as Json),
						createdAt: new Date().toISOString(),
						id: `message-${messages.length + 1}`,
					};
					messages.push(message);
					return [message];
				},
				onConflictDoNothing: () => ({
					returning: async () => {
						assert.equal(table, wgChatMentions);
						mentions.push(...(value as unknown[]));
						return value;
					},
				}),
			}),
		}),
		delete: (table: unknown) => ({
			where: () => ({
				returning: async () => {
					assert.equal(table, idempotencyResponses);
					const claimed = JSON.stringify(slot) === '{"_claimed":true}';
					slot = null;
					return claimed ? [{ scope: 'chat-message' }] : [];
				},
			}),
		}),
		update: (table: unknown) => ({
			set: (value: { responseBody: Json }) => ({
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
};

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => state.audits++ } });
mock.module('@/core/db', {
	namedExports: {
		db,
		idempotencyResponses,
		wgChatMentions,
		wgChatMessages,
		wgChatReactions: {},
		wgChatReads,
		wgMembers,
	},
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort,
		lockExpensePayments: async () => {
			state.locks++;
		},
		withTransaction,
	},
});
mock.module('@/core/guards/api-auth', { namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i } });
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: async () => {
			state.claims++;
			if (!state.slot) state.slot = { _claimed: true };
			return { won: true };
		},
	},
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' },
			member: { memberId, name: 'Member' },
		}),
	},
});
// Errors reach the test as rejections instead of becoming a 500 response.
mock.module('@/core/guards/with-wg-route', {
	namedExports: {
		withWgRoute:
			(_label: string, handler: (req: Request, params: unknown) => unknown) =>
			async (req: Request, ctx: { params: Promise<unknown> }) =>
				handler(req, await ctx.params),
	},
});
// `setReplayWarning` stays real so its generated UPDATE runs against the fake db.
const realStore = await import('@/core/idempotency-store');
mock.module('@/core/idempotency-store', {
	namedExports: {
		claimResponseSlot: async () => null,
		getCachedResponse: async () => (state.slot && !state.slot._claimed ? state.slot : null),
		readIdempotencyKey: (req: Request) => req.headers.get('idempotency-key'),
		setReplayWarning: realStore.setReplayWarning,
	},
});
mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: () => undefined,
		logApiError: (label: string, err: unknown) => state.errors.push(`${label}: ${err}`),
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
mock.module('@/core/rate-limit', {
	namedExports: { chatMessageLimiter: {}, checkRateLimit: async () => ({ success: true }) },
});

const { GET, POST } = await import('./route');

function harness() {
	reset();
	return {
		state,
		post: () =>
			POST(
				new Request('https://example.invalid', {
					method: 'POST',
					headers: { 'Idempotency-Key': key },
					body: JSON.stringify({ body: 'Hello', mentionMemberIds: [mentionedId] }),
				}) as never,
				{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
			),
	};
}

test('concurrent claimed retries commit one chat message and replay one response', async () => {
	const { state, post } = harness();
	const responses = await Promise.all([post(), post()]);
	const bodies = await Promise.all(responses.map((response) => response.json()));
	assert.deepEqual(bodies[0], bodies[1]);
	assert.equal(state.messages.length, 1);
	assert.equal(state.mentions.length, 1);
	assert.equal(state.audits, 1);
	assert.equal(state.notifications, 2);
	// Stamped by the database clock at insert time (after the WG lock), not at transaction start.
	assert.match(
		new PgDialect().sqlToQuery(state.insertedCreatedAt as never).sql,
		/clock_timestamp\(\)/,
	);
});

test('a sender deactivated while waiting for the lock is rejected without a message', async () => {
	const { state, post } = harness();
	state.senderActive = false;
	const response = await post();
	assert.equal(response.status, 401);
	assert.deepEqual(await response.json(), { error: 'member_deactivated' });
	assert.equal(state.messages.length, 0);
	assert.equal(state.mentions.length, 0);
	assert.equal(state.audits, 0);
	assert.equal(state.notifications, 0);
	// The rejection is not stored, so the claim is released.
	assert.equal(state.slot, null);
});

test('failed replay write rolls back message and mentions before a safe retry', async () => {
	const { state, post } = harness();
	state.failReplayWrite = true;
	await assert.rejects(post(), /cache_write_failed/);
	assert.equal(state.messages.length, 0);
	assert.equal(state.mentions.length, 0);
	assert.equal(state.notifications, 0);
	assert.match(state.releaseWhere, /expires_at/, JSON.stringify(state.errors));
	assert.match(state.releaseWhere, /_claimed/);
	assert.equal(state.slot, null);
	state.failReplayWrite = false;
	assert.equal((await post()).status, 200);
	assert.equal(state.messages.length, 1);
	assert.equal(state.claims, 2);
});

test('malformed claim cannot authorize a chat insert', async () => {
	const { state, post } = harness();
	state.slot = { _claimed: true, extra: 1 };
	await assert.rejects(post(), /idempotency_claim_invalid/);
	assert.equal(state.messages.length, 0);
});

test('uncertain COMMIT outcome keeps the claim fail-closed', async () => {
	const { state, post } = harness();
	state.failCommit = true;
	await assert.rejects(post(), /commit_outcome_unknown/);
	assert.deepEqual(state.slot, { _claimed: true });
	assert.equal(state.releaseWhere, '');
	assert.equal(state.notifications, 0);
});

test('failed warning enrichment leaves replay base response unchanged', async () => {
	const { state, post } = harness();
	state.warning = 'notification_delivery_failed';
	state.warningUpdateSucceeds = false;
	const first = (await (await post()).json()) as { warning: unknown };
	const replay = (await (await post()).json()) as { warning: unknown };
	assert.equal(first.warning, null);
	assert.equal(replay.warning, null);
	assert.equal(state.messages.length, 1);
	assert.equal(state.notifications, 2);
	assert.match(state.warningWhere, /expires_at/);
	assert.match(state.warningWhere, /message/);
	assert.match(state.warningWhere, /warning/);
});

test('persisted notification warning is replayed without a second dispatch', async () => {
	const { state, post } = harness();
	state.warning = 'notification_delivery_failed';
	const first = (await (await post()).json()) as { warning: unknown };
	const replay = (await (await post()).json()) as { warning: unknown };
	assert.equal(first.warning, state.warning);
	assert.equal(replay.warning, state.warning);
	assert.equal(state.messages.length, 1);
	assert.equal(state.notifications, 2);
});

test('GET returns the read marker only when the bootstrap asks for it', async () => {
	reset();
	const marker = { messageId: 'message-1', createdAt: new Date('2026-09-23T10:00:00.000Z') };
	state.readMarkerRows = [marker];
	const get = async (query: string) => {
		const response = await GET(
			new Request(`https://example.invalid/?${query}`) as never,
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
		);
		return (await response.json()) as { readMarker?: unknown };
	};
	assert.equal('readMarker' in (await get('limit=50')), false);
	assert.equal(state.readMarkerQueries, 0);
	assert.deepEqual((await get('limit=50&includeReadMarker=1')).readMarker, {
		...marker,
		createdAt: marker.createdAt.toISOString(),
	});
	state.readMarkerRows = [];
	assert.equal((await get('includeReadMarker=1')).readMarker, null);
});
