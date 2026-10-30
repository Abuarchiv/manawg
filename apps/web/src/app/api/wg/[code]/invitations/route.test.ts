import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';

const wgInvites = { id: 'wg_invites.id', revokedAt: 'wg_invites.revoked_at' };
const inviteId = '33333333-3333-4333-8333-333333333333';
const mailError = new Error('boom');

const state = {
	revoked: [] as unknown[],
	logged: [] as unknown[][],
	order: [] as string[],
};

const db = {
	select: () => ({
		from: () => ({ where: () => ({ orderBy: async () => [{ name: 'Alex' }] }) }),
	}),
	update: () => ({
		set: () => ({
			where: async (condition: unknown) => {
				state.order.push('revoke');
				state.revoked.push(condition);
			},
		}),
	}),
};

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/db', { namedExports: { db, wgInvites, wgMembers: {} } });
mock.module('@/core/db/wg-invites', {
	namedExports: { createWgInvite: async () => ({ id: inviteId, token: 'token' }) },
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: 'wg-1', name: 'Haus' },
			member: { memberId: 'member-1', name: 'Mina' },
			authUserId: 'user-1',
		}),
	},
});
mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: () => undefined,
		logApiError: (...args: unknown[]) => {
			state.order.push('log');
			state.logged.push(args);
		},
	},
});
mock.module('@/core/mail/send-mail', {
	namedExports: {
		sendMail: async () => {
			throw mailError;
		},
	},
});
mock.module('@/core/mail/templates', {
	namedExports: { renderInvitationMail: () => ({ subject: 's', html: 'h', text: 't' }) },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		inviteMailAccountLimiter: {},
		inviteMailLimiter: {},
		inviteMailRecipientLimiter: {},
	},
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...conditions: unknown[]) => conditions,
		asc: (column: unknown) => column,
		eq: (column: unknown, value: unknown) => ({ column, value }),
		isNull: (column: unknown) => ({ column, value: null }),
	},
});

const { POST } = await import('./route');

test('a mail provider failure is logged, then the invite is revoked and the caller gets 503', async () => {
	const request = new NextRequest('https://example.test/api/wg/MTE8PZAT/invitations', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: 'new@example.test' }),
	});
	const response = await POST(request, { params: Promise.resolve({ code: 'MTE8PZAT' }) });

	assert.equal(response.status, 503);
	assert.deepEqual(await response.json(), { error: 'mail_unavailable', code: 'mail_unavailable' });
	assert.equal(state.revoked.length, 1);
	assert.equal(state.logged.length, 1);
	assert.equal(state.logged[0]?.[1], mailError);
	assert.deepEqual(state.order, ['log', 'revoke']);
});
