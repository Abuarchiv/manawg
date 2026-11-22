import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { wgMembers, wgs } from '@/core/db/schema';
import type { SendMailInput, SendMailResult } from './send-mail';

// What the solo invite run hands to the mailer: the member's stored language, the WG link and the
// member's own unsubscribe link. Who is selected is covered against PostgreSQL in
// tests/solo-invite-db.test.ts.
process.env.MEMBER_SESSION_SECRET = 'test-secret';

let candidates: Record<string, unknown>[] = [];
const chain = {
	select: () => chain,
	from: () => chain,
	innerJoin: () => chain,
	where: () => chain,
	orderBy: () => chain,
	limit: async () => candidates,
};
mock.module('@/core/db', { namedExports: { db: chain, wgMembers, wgs } });
mock.module('@/core/auth/auth-user-emails', {
	namedExports: {
		loadConfirmedEmails: async (ids: readonly string[]) => ({
			emails: new Map(ids.map((id) => [id, `${id}@example.org`])),
			locales: new Map(),
			unresolved: new Set(),
		}),
	},
});
const sent: SendMailInput[] = [];
let results: SendMailResult[] = [];
mock.module('./send-mail', {
	namedExports: {
		sendMailSafely: async (input: SendMailInput) => {
			sent.push(input);
			return results.shift() ?? 'sent';
		},
	},
});
const { APP_ORIGIN } = await import('./brand-mail');
const { unsubscribeUrl } = await import('./unsubscribe');
const { sendSoloInviteMails } = await import('./solo-invite');

function row(n: number, locale: string | null) {
	return {
		wgId: `wg-${n}`,
		wgName: `Flat ${n}`,
		shareCode: `CODE${n}`,
		memberId: `00000000-0000-4000-8000-00000000000${n}`,
		authUserId: `user-${n}`,
		locale,
	};
}

test('each admin gets the reminder in their stored language, with their links', async () => {
	candidates = [row(1, 'de'), row(2, 'en'), row(3, 'es'), row(4, 'fr'), row(5, null)];
	sent.length = 0;
	const run = await sendSoloInviteMails();
	assert.deepEqual(run, { candidates: 5, sent: 5, skipped: 0, failed: 0, deferred: 0 });
	assert.deepEqual(
		sent.map((input) => input.mail.subject),
		[
			'Noch allein in Flat 1',
			'Still on your own in Flat 2',
			'Aún no hay nadie más en Flat 3',
			// An unknown or missing language falls back to the default (German).
			'Noch allein in Flat 4',
			'Noch allein in Flat 5',
		],
	);
	for (const [index, input] of sent.entries()) {
		const candidate = candidates[index] as ReturnType<typeof row>;
		const unsubscribe = unsubscribeUrl(candidate.memberId, 'onboarding');
		assert.equal(input.to, `${candidate.authUserId}@example.org`);
		assert.equal(input.dedupeKey, `solo_invite:${candidate.wgId}`);
		assert.equal(input.unsubscribeUrl, unsubscribe);
		for (const body of [input.mail.text, input.mail.html]) {
			assert.ok(body.includes(`${APP_ORIGIN}/wg/${candidate.shareCode}`), 'joining link');
			assert.ok(body.includes(unsubscribe), 'unsubscribe link in the body');
		}
	}
});

test('a quota stop sends nothing more and counts the rest as deferred', async () => {
	candidates = [row(1, 'de'), row(2, 'de'), row(3, 'de'), row(4, 'de')];
	sent.length = 0;
	results = ['sent', 'deferred'];
	const run = await sendSoloInviteMails();
	assert.deepEqual(run, { candidates: 4, sent: 1, skipped: 0, failed: 0, deferred: 3 });
	assert.equal(sent.length, 2, 'no mail is attempted after the provider asked to wait');
});
