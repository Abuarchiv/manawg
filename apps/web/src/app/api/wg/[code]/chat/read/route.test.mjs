import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const routeFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'route.ts');
const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const messageId = '44444444-4444-4444-8444-444444444444';

function harness({ changedRows }) {
	const state = { upsert: null, markerCalls: [] };
	const wgChatReads = {
		wgId: 'wg_chat_reads.wg_id',
		memberId: 'wg_chat_reads.member_id',
		lastReadMessageId: 'wg_chat_reads.last_read_message_id',
	};
	const wgChatMessages = { id: 'wg_chat_messages.id', wgId: 'wg_chat_messages.wg_id' };
	const db = {
		select: () => ({
			from: () => ({ where: () => ({ limit: async () => [{ id: messageId }] }) }),
		}),
		insert: (table) => {
			assert.equal(table, wgChatReads);
			return {
				values: (values) => ({
					onConflictDoUpdate: (config) => {
						state.upsert = { values, config };
						return { returning: async () => changedRows };
					},
				}),
			};
		},
	};
	const json = (body, status) => Response.json(body, { status });
	const mocks = {
		'@/core/db': { db, wgChatMessages, wgChatReads },
		'@/core/http/read-json': { readJsonLimited: (req) => req.json() },
		'@/core/errors': {
			badRequest: (error) => json({ error }, 400),
			notFound: (error) => json({ error }, 404),
			tooMany: () => json({ error: 'rate_limited' }, 429),
		},
		'@/core/guards/api-auth': { UUID_PATTERN: /^[0-9a-f-]{36}$/i },
		'@/core/guards/require-wg-member': {
			requireWgMember: async () => ({
				ok: true,
				wg: { id: wgId },
				member: { memberId, verified: true },
			}),
		},
		'@/core/guards/with-wg-route': {
			withWgRoute: (_label, handler) => (req, ctx) => handler(req, ctx),
		},
		'@/core/rate-limit': { chatReadLimiter: {}, checkRateLimit: async () => ({ success: true }) },
		'@/features/chat/chat-read-query': {
			buildChatReadMarkerSetWhere: (candidate, current) => {
				state.markerCalls.push([candidate, current]);
				return { candidate };
			},
		},
		'drizzle-orm': { and: (...parts) => parts, eq: (...parts) => parts },
		'next/server': { NextResponse: { json: (body) => Response.json(body) } },
	};
	const compiled = transpileModule(readFileSync(routeFile, 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (Object.hasOwn(mocks, name) ? mocks[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	const post = (lastReadMessageId) =>
		module.exports.POST(
			new Request('https://example.invalid/api/wg/MTE8PZAT/chat/read', {
				method: 'POST',
				body: JSON.stringify({ lastReadMessageId }),
			}),
			{ code: 'MTE8PZAT' },
		);
	return { post, state, wgChatReads };
}

test('a null read marker resets the stored marker and reports the change', async () => {
	const { post, state, wgChatReads } = harness({ changedRows: [{ memberId }] });

	const response = await post(null);

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { ok: true, applied: true });
	assert.equal(state.upsert.values.lastReadMessageId, null);
	assert.equal(state.upsert.config.set.lastReadMessageId, null);
	assert.deepEqual(state.markerCalls, [[null, wgChatReads.lastReadMessageId]]);
});

test('an ignored read receipt reports applied: false', async () => {
	for (const lastReadMessageId of [null, messageId]) {
		const { post } = harness({ changedRows: [] });

		const response = await post(lastReadMessageId);

		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { ok: true, applied: false });
	}
});
