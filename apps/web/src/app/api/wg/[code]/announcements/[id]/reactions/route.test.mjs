import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const file = path.join(
	process.cwd(),
	'src/app/api/wg/[code]/announcements/[id]/reactions/route.ts',
);
const announcementId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const authorId = '33333333-3333-4333-8333-333333333333';
const wgId = '44444444-4444-4444-8444-444444444444';
const keyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const keyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function harness() {
	const state = {
		reaction: null,
		status: 'open',
		locks: 0,
		audits: [],
		notifications: 0,
	};
	const cache = new Map();
	let prior = Promise.resolve();
	const announcement = {
		id: announcementId,
		authorMemberId: authorId,
		content: 'Post',
		status: state.status,
	};
	const announcements = {
		id: 'id',
		wgId: 'wg_id',
		authorMemberId: 'author_member_id',
		content: 'content',
		status: 'status',
	};
	const announcementReactions = {
		id: 'id',
		announcementId: 'announcement_id',
		memberId: 'member_id',
		reaction: 'reaction',
	};
	const withAnnouncementReplay = async (req, scope, mutate) => {
		const key = req.headers.get('idempotency-key');
		const cacheKey = `${scope}:${key}`;
		const waitFor = prior;
		let release = () => undefined;
		prior = new Promise((resolve) => {
			release = resolve;
		});
		await waitFor;
		try {
			const cached = cache.get(cacheKey);
			if (cached) return { response: cached, effect: null, key };
			const tx = {
				select: () => ({
					from: (table) => ({
						where: () => ({
							limit: () =>
								table === announcements
									? {
											for: async () => {
												state.locks++;
												return [{ ...announcement, status: state.status }];
											},
										}
									: Promise.resolve(state.reaction ? [state.reaction] : []),
						}),
					}),
				}),
				delete: (table) => ({
					where: () => ({
						returning: async () => {
							assert.equal(table, announcementReactions);
							const removed = state.reaction;
							state.reaction = null;
							return removed ? [removed] : [];
						},
					}),
				}),
				insert: (table) => ({
					values: () => ({
						onConflictDoNothing: () => ({
							returning: async () => {
								assert.equal(table, announcementReactions);
								if (state.reaction) return [];
								state.reaction = { id: 'reaction-1' };
								return [state.reaction];
							},
						}),
					}),
				}),
			};
			const outcome = await mutate(tx);
			cache.set(cacheKey, outcome.response);
			return { ...outcome, key };
		} finally {
			release();
		}
	};
	const source = transpileModule(readFileSync(file, 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	const overrides = {
		'@/core/audit': { recordAuditEvent: async (event) => state.audits.push(event.eventType) },
		'@/core/db': { announcements, announcementReactions },
		'@/core/http/read-json': { readJsonLimited: (req) => req.json() },
		'@/core/errors': { badRequest: (error) => Response.json({ error }, { status: 400 }) },
		'@/core/guards/api-auth': { UUID_PATTERN: /^[0-9a-f-]{36}$/i },
		'@/core/guards/require-wg-member': {
			requireWgMember: async () => ({
				ok: true,
				wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' },
				member: { memberId, name: 'Member' },
			}),
		},
		'@/core/guards/with-wg-route': { withWgRoute: (_label, handler) => handler },
		'@/core/infra/observability': { logApiError: () => undefined },
		'@/core/notifications/notification-dispatch': {
			dispatchNotificationSafely: async () => {
				state.notifications++;
				return { warning: null };
			},
		},
		'@/core/rate-limit': { checkRateLimit: async () => ({ success: true }) },
		'@/features/pinnwand/announcement-replay': {
			withAnnouncementReplay,
			persistAnnouncementReplayWarning: async () => true,
		},
		'@/features/pinnwand/announcement-workflow': {
			ANNOUNCEMENT_REACTIONS: ['seen', 'take', 'ok'],
		},
		'drizzle-orm': { and: (...parts) => parts, eq: (...parts) => parts },
		'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
	};
	new Function('require', 'module', 'exports', source)(
		(name) => (name in overrides ? overrides[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	return {
		state,
		post: (key, active) =>
			module.exports.POST(
				new Request('https://example.invalid', {
					method: 'POST',
					headers: { 'Idempotency-Key': key },
					body: JSON.stringify({ reaction: 'seen', ...(active === undefined ? {} : { active }) }),
				}),
				{ code: 'MTE8PZAT', id: announcementId },
			),
	};
}

test('same key replays an added reaction without toggling it off', async () => {
	const { state, post } = harness();
	const first = await (await post(keyA)).json();
	const replay = await (await post(keyA)).json();
	assert.deepEqual(first, replay);
	assert.equal(first.active, true);
	assert.equal(state.reaction?.id, 'reaction-1');
	assert.deepEqual(state.audits, ['announcement.reaction.added']);
	assert.equal(state.notifications, 1);
	assert.equal(state.locks, 1);
});

test('two distinct legacy toggle keys serialize add then remove', async () => {
	const { state, post } = harness();
	const [added, removed] = await Promise.all([post(keyA), post(keyB)]);
	assert.equal((await added.json()).active, true);
	assert.equal((await removed.json()).active, false);
	assert.equal(state.reaction, null);
	assert.deepEqual(state.audits, ['announcement.reaction.added', 'announcement.reaction.removed']);
	assert.equal(state.notifications, 1);
	assert.equal(state.locks, 2);
});

test('explicit active true with a new key is a no-op when already active', async () => {
	const { state, post } = harness();
	await post(keyA, true);
	const second = await (await post(keyB, true)).json();
	assert.equal(second.active, true);
	assert.equal(state.reaction?.id, 'reaction-1');
	assert.deepEqual(state.audits, ['announcement.reaction.added']);
	assert.equal(state.notifications, 1);
});
