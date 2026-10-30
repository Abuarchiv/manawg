import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { rewriteImageOrigins } from '../scripts/selfhost/image-origin.mjs';

// Opt-in against a real PostgreSQL: TEST_DATABASE_URL must name a disposable loopback database
// with all migrations applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
}

const NEW_ORIGIN = 'https://new.example';

test('rewriteImageOrigins moves stored receipt links onto the current origin', {
	skip,
}, async () => {
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	const suffix = randomUUID().replaceAll('-', '');
	const wgId = randomUUID();
	const memberId = randomUUID();
	const key = (kind: string) => encodeURIComponent(`manawg/${wgId}/${kind}/${randomUUID()}.jpg`);
	const old = (kind: string) => `http://old.example/api/upload/read?key=${key(kind)}`;
	const current = `${NEW_ORIGIN}/api/upload/read?key=${key('expense')}`;
	const external = 'https://cdn.other.example/photo.jpg';
	try {
		await client.query('insert into wgs (id, share_code, name) values ($1, $2, $3)', [
			wgId,
			`I${suffix.slice(0, 7)}`,
			`Image origin ${suffix}`,
		]);
		await client.query('insert into wg_members (id, wg_id, name) values ($1, $2, $3)', [
			memberId,
			wgId,
			'Member',
		]);
		const expense = async (imageUrl: string | null) => {
			const id = randomUUID();
			await client.query(
				`insert into expenses (id, wg_id, paid_by_member_id, amount_cents, description, image_url)
				 values ($1, $2, $3, 100, 'Groceries', $4)`,
				[id, wgId, memberId, imageUrl],
			);
			return id;
		};
		const oldExpense = await expense(old('expense'));
		const currentExpense = await expense(current);
		const externalExpense = await expense(external);
		const nullExpense = await expense(null);
		const announcementId = randomUUID();
		await client.query(
			`insert into announcements (id, wg_id, author_member_id, content, image_url)
			 values ($1, $2, $3, 'Note', $4)`,
			[announcementId, wgId, memberId, old('announcement')],
		);
		const chatId = randomUUID();
		await client.query(
			`insert into wg_chat_messages (id, wg_id, sender_member_id, kind, image_url)
			 values ($1, $2, $3, 'image', $4)`,
			[chatId, wgId, memberId, old('chat')],
		);

		const first = await rewriteImageOrigins(client, NEW_ORIGIN);
		assert.ok((first.expenses ?? 0) >= 1);
		assert.ok((first.announcements ?? 0) >= 1);
		assert.ok((first.wg_chat_messages ?? 0) >= 1);
		const second = await rewriteImageOrigins(client, NEW_ORIGIN);
		assert.equal(second.expenses, 0);
		assert.equal(second.announcements, 0);
		assert.equal(second.wg_chat_messages, 0);

		const imageUrl = async (table: string, id: string) =>
			(await client.query(`select image_url from ${table} where id = $1`, [id])).rows[0]
				.image_url as string | null;
		const prefix = `${NEW_ORIGIN}/api/upload/read?key=manawg%2F${wgId}%2F`;
		assert.ok((await imageUrl('expenses', oldExpense))?.startsWith(prefix));
		assert.ok((await imageUrl('announcements', announcementId))?.startsWith(prefix));
		assert.ok((await imageUrl('wg_chat_messages', chatId))?.startsWith(prefix));
		assert.equal(await imageUrl('expenses', currentExpense), current);
		assert.equal(await imageUrl('expenses', externalExpense), external);
		assert.equal(await imageUrl('expenses', nullExpense), null);
	} finally {
		await client.query('delete from wgs where id = $1', [wgId]);
		await client.end();
	}
});
