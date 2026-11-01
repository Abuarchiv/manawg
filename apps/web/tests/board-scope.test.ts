import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import pg from 'pg';

// The board listing against a real PostgreSQL: its visibility window and WG scope live in SQL,
// which the mocked route tests cannot see. Opt-in: TEST_DATABASE_URL must name a disposable
// loopback database with all migrations applied (`pnpm test:db`).
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

const DAY = 24 * 60 * 60 * 1000;
const caller = { memberId: '', name: 'Caller' };
const wg = { id: '' };
mock.module('@/core/guards/require-wg-member', {
	namedExports: { requireWgMember: async () => ({ ok: true, wg, member: caller }) },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});

const pool = new pg.Pool({ connectionString: url || undefined, max: 2 });
const ids = { wgA: '', wgB: '', admin: '', otherMember: '' };

async function one<T>(sql: string, params: unknown[]): Promise<T> {
	return (await pool.query(sql, params)).rows[0] as T;
}

async function insertPost(
	wgId: string,
	authorId: string,
	title: string,
	opts: {
		ageDays: number;
		kind?: string;
		status?: string;
		source?: string;
		pinnedDaysAgo?: number;
		resolvedDaysAgo?: number;
	},
): Promise<string> {
	const at = (days: number) => new Date(Date.now() - days * DAY);
	const row = await one<{ id: string }>(
		`INSERT INTO public.announcements
			(wg_id, author_member_id, content, kind, status, source, created_at, pinned_at, resolved_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
		[
			wgId,
			authorId,
			title,
			opts.kind ?? 'info',
			opts.status ?? 'open',
			opts.source ?? 'manual',
			at(opts.ageDays),
			opts.pinnedDaysAgo === undefined ? null : at(opts.pinnedDaysAgo),
			opts.resolvedDaysAgo === undefined ? null : at(opts.resolvedDaysAgo),
		],
	);
	return row.id;
}

before(async () => {
	if (skip) return;
	const suffix = randomUUID().replaceAll('-', '');
	for (const key of ['wgA', 'wgB'] as const) {
		ids[key] = (
			await one<{ id: string }>(
				'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
				[`${key === 'wgA' ? 'A' : 'B'}${suffix.slice(0, 7)}`, `Board ${key} ${suffix}`],
			)
		).id;
	}
	const member = async (wgId: string, name: string, role: string) =>
		(
			await one<{ id: string }>(
				'INSERT INTO public.wg_members (wg_id, name, role) VALUES ($1, $2, $3) RETURNING id',
				[wgId, `${name} ${suffix}`, role],
			)
		).id;
	ids.admin = await member(ids.wgA, 'Admin', 'admin');
	ids.otherMember = await member(ids.wgB, 'Other', 'admin');
	wg.id = ids.wgA;
	caller.memberId = ids.admin;
});

after(async () => {
	if (skip) return;
	await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [[ids.wgA, ids.wgB]]);
	await pool.end();
});

test('board lists pinned, open asks and posts of the last 30 days, scoped to the WG', {
	skip,
}, async () => {
	const { GET } = await import('../src/app/api/wg/[code]/announcements/route.ts');
	const { admin, wgA, wgB, otherMember } = ids;
	const keep = {
		recent: await insertPost(wgA, admin, 'recent info', { ageDays: 10 }),
		pinnedOld: await insertPost(wgA, admin, 'old pinned info', { ageDays: 90, pinnedDaysAgo: 80 }),
		pinnedLate: await insertPost(wgA, admin, 'newer pin', { ageDays: 95, pinnedDaysAgo: 2 }),
		openQuestion: await insertPost(wgA, admin, 'old open question', {
			ageDays: 90,
			kind: 'question',
		}),
		openProblem: await insertPost(wgA, admin, 'old open problem', { ageDays: 90, kind: 'problem' }),
		openRequest: await insertPost(wgA, admin, 'old open request', { ageDays: 90, kind: 'request' }),
		swap: await insertPost(wgA, admin, 'old open swap', {
			ageDays: 90,
			kind: 'request',
			source: 'chore_swap',
		}),
		resolvedRecently: await insertPost(wgA, admin, 'resolved 5 days ago', {
			ageDays: 90,
			kind: 'question',
			status: 'resolved',
			resolvedDaysAgo: 5,
		}),
		commented: await insertPost(wgA, admin, 'old but discussed', { ageDays: 90 }),
	};
	const drop = {
		oldInfo: await insertPost(wgA, admin, 'old open info', { ageDays: 45 }),
		oldDecision: await insertPost(wgA, admin, 'old open decision', {
			ageDays: 45,
			kind: 'decision',
		}),
		oldResolvedInfo: await insertPost(wgA, admin, 'old resolved info', {
			ageDays: 45,
			status: 'resolved',
			resolvedDaysAgo: 40,
		}),
		oldResolvedQuestion: await insertPost(wgA, admin, 'old resolved question', {
			ageDays: 90,
			kind: 'question',
			status: 'resolved',
			resolvedDaysAgo: 40,
		}),
		system: await insertPost(wgA, admin, 'automatic notice', { ageDays: 1, source: 'system' }),
		expense: await insertPost(wgA, admin, 'automatic expense', { ageDays: 1, source: 'expense' }),
		otherWg: await insertPost(wgB, otherMember, 'foreign recent', { ageDays: 1 }),
		otherWgQuestion: await insertPost(wgB, otherMember, 'foreign question', {
			ageDays: 90,
			kind: 'question',
		}),
	};
	await pool.query(
		`INSERT INTO public.announcement_comments (announcement_id, member_id, content, created_at)
		 VALUES ($1, $2, 'fresh reply', $3), ($4, $2, 'stale reply', $5)`,
		[
			keep.commented,
			admin,
			new Date(Date.now() - 3 * DAY),
			drop.oldInfo,
			new Date(Date.now() - 40 * DAY),
		],
	);

	const response = await GET(
		new Request('https://example.invalid/api/wg/MTE8PZAT/announcements') as never,
		{
			params: Promise.resolve({ code: 'MTE8PZAT' }),
		} as never,
	);
	assert.equal(response.status, 200);
	const listed = ((await response.json()) as { announcements: { id: string }[] }).announcements.map(
		(post) => post.id,
	);
	assert.deepEqual([...listed].sort(), Object.values(keep).sort());
	for (const id of Object.values(drop)) assert.ok(!listed.includes(id));
	// Pinned posts first with the latest pin on top, then newest first.
	assert.deepEqual(listed.slice(0, 2), [keep.pinnedLate, keep.pinnedOld]);
	assert.equal(listed[2], keep.recent);
});
