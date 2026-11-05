import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import pg from 'pg';

// The undo list of imports pages back through the history and skips settled imports, so many
// settled ones cannot crowd an undoable import out. Only provable against real rows.
// Opt-in: TEST_DATABASE_URL must name a disposable loopback database (`pnpm test:db`).
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

const pool = new pg.Pool({ connectionString: url || undefined, max: 3 });
const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
	(await pool.query(sql, params)).rows as T[];
const wgIds: string[] = [];

async function newWg() {
	const suffix = randomUUID().replaceAll('-', '');
	const [wg] = await q<{ id: string }>(
		'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
		[suffix.slice(0, 8).toUpperCase(), `Imports ${suffix}`],
	);
	const wgId = wg?.id ?? '';
	wgIds.push(wgId);
	const member = async (name: string) =>
		(
			await q<{ id: string }>(
				'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
				[wgId, `${name} ${suffix}`],
			)
		)[0]?.id ?? '';
	return { wgId, anna: await member('Anna'), ben: await member('Ben') };
}

/** `count` imports by `importer`, each with one expense Anna paid for Ben, `minutesAgo` apart. */
async function addImports(
	wgId: string,
	importer: string,
	payer: string,
	debtor: string,
	opts: { count: number; startMinutesAgo: number; settled: boolean; inserted?: number },
) {
	const rows = await q<{ id: string }>(
		`WITH imp AS (
		   INSERT INTO public.expense_imports (wg_id, source, imported_by_member_id, row_count_inserted, started_at)
		   SELECT $1, 'splid_csv', $2, $5, now() - make_interval(mins => $6 + g)
		   FROM generate_series(1, $4) g RETURNING id, started_at
		 ), exp AS (
		   INSERT INTO public.expenses (wg_id, paid_by_member_id, amount_cents, description, import_id)
		   SELECT $1, $3, 1000, 'Import', id FROM imp RETURNING id
		 ), spl AS (
		   INSERT INTO public.expense_splits (expense_id, debtor_member_id, amount_cents, settled_at)
		   SELECT id, $7, 1000, CASE WHEN $8 THEN now() END FROM exp
		 )
		 SELECT id FROM imp ORDER BY started_at DESC`,
		[
			wgId,
			importer,
			payer,
			opts.count,
			opts.inserted ?? 1,
			opts.startMinutesAgo,
			debtor,
			opts.settled,
		],
	);
	return rows.map((row) => row.id);
}

const history = () => import('../src/features/expenses/server/import-history.ts');

after(async () => {
	if (skip) return;
	if (wgIds.length) {
		await pool.query('DELETE FROM public.expenses WHERE wg_id = ANY($1)', [wgIds]);
		await pool.query('DELETE FROM public.expense_imports WHERE wg_id = ANY($1)', [wgIds]);
		await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [wgIds]);
	}
	await pool.end();
});

test('an undoable import behind more than a page of settled ones is still listed', {
	skip,
}, async () => {
	const { listUndoableImports } = await history();
	const { wgId, anna, ben } = await newWg();
	await addImports(wgId, anna, anna, ben, { count: 55, startMinutesAgo: 0, settled: true });
	const [old] = await addImports(wgId, anna, anna, ben, {
		count: 1,
		startMinutesAgo: 100,
		settled: false,
	});

	const listed = await listUndoableImports(wgId, null);
	assert.deepEqual(
		listed.map((entry) => entry.id),
		[old],
	);
});

test('the list holds the ten newest undoable imports, filtered by importer', {
	skip,
}, async () => {
	const { listUndoableImports } = await history();
	const { wgId, anna, ben } = await newWg();
	const annas = await addImports(wgId, anna, anna, ben, {
		count: 12,
		startMinutesAgo: 0,
		settled: false,
	});
	const [bens] = await addImports(wgId, ben, ben, anna, {
		count: 1,
		startMinutesAgo: 200,
		settled: false,
	});
	// An import that inserted nothing has nothing to undo.
	await addImports(wgId, anna, anna, ben, {
		count: 1,
		startMinutesAgo: -5,
		settled: false,
		inserted: 0,
	});

	const all = await listUndoableImports(wgId, null);
	assert.deepEqual(
		all.map((entry) => entry.id),
		annas.slice(0, 10),
	);
	assert.deepEqual(
		(await listUndoableImports(wgId, ben)).map((entry) => entry.id),
		[bens],
	);
	assert.equal((await listUndoableImports(wgId, anna)).length, 10);
	// Another flat sees none of them.
	assert.deepEqual(await listUndoableImports((await newWg()).wgId, null), []);
});
