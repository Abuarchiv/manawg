import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const absenceId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const callerId = '33333333-3333-4333-8333-333333333333';
const ownerId = '44444444-4444-4444-8444-444444444444';

const memberAbsences = { id: 'id', wgId: 'wgId', memberId: 'memberId' };
const state = { absenceOwnerId: ownerId, isAdmin: false, deletes: 0, audits: 0 };

mock.module('drizzle-orm', {
	namedExports: { and: (...parts: unknown[]) => parts, eq: (...parts: unknown[]) => parts },
});
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			state.audits += 1;
		},
	},
});
mock.module('@/core/db', {
	namedExports: {
		memberAbsences,
		wgMembers: {},
		db: {
			select: () => ({
				from: () => ({
					where: () => ({ limit: async () => [{ memberId: state.absenceOwnerId }] }),
				}),
			}),
			delete: () => ({
				where: () => ({
					returning: async () => {
						state.deletes += 1;
						return [
							{
								id: absenceId,
								memberId: state.absenceOwnerId,
								startDate: new Date('2026-09-24T00:00:00Z'),
								endDate: new Date('2026-09-25T00:00:00Z'),
							},
						];
					},
				}),
			}),
		},
	},
});
// The guard keeps its rule: the owner or a WG admin passes, anyone else is refused.
mock.module('@/core/guards/admin', {
	namedExports: {
		requireOwnerOrAdmin: async (
			_wgId: string,
			member: { memberId: string },
			ownerMemberId: string,
		) =>
			ownerMemberId === member.memberId || state.isAdmin
				? null
				: Response.json({ error: 'not_owner' }, { status: 403 }),
	},
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId },
			member: { memberId: callerId, name: 'Mina' },
		}),
	},
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});

const { DELETE } = await import('./route');

const call = () =>
	DELETE(
		new Request('http://localhost/api/wg/MTE8PZAT/absences/x', { method: 'DELETE' }) as never,
		{
			params: Promise.resolve({ code: 'MTE8PZAT', id: absenceId }),
		} as never,
	);

const reset = (patch: Partial<typeof state>) =>
	Object.assign(state, { absenceOwnerId: ownerId, isAdmin: false, deletes: 0, audits: 0 }, patch);

test('a member cannot delete another member absence', async () => {
	reset({});
	const response = await call();
	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), { error: 'not_owner' });
	assert.equal(state.deletes, 0);
	assert.equal(state.audits, 0);
});

test('the owner deletes their own absence', async () => {
	reset({ absenceOwnerId: callerId });
	const response = await call();
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { deleted: absenceId });
	assert.equal(state.deletes, 1);
	assert.equal(state.audits, 1);
});

test('a WG admin deletes another member absence', async () => {
	reset({ isAdmin: true });
	const response = await call();
	assert.equal(response.status, 200);
	assert.equal(state.deletes, 1);
	assert.equal(state.audits, 1);
});
