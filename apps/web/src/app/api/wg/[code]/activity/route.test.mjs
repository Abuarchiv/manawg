import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));

function loadTs(file, overrides = {}) {
	const source = transpileModule(readFileSync(path.join(process.cwd(), file), 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', source)(
		(name) => (name in overrides ? overrides[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	return module.exports;
}

test('due chores are the overdue ones, oldest first, so the 120-row cap keeps them', async () => {
	const tableNames = [
		'announcements',
		'auditEvents',
		'choreCompletions',
		'chores',
		'expenses',
		'memberAbsences',
		'recurringExpenses',
		'shoppingItems',
		'wgMembers',
	];
	const tables = Object.fromEntries(
		tableNames.map((name) => [
			name,
			{ name, wgId: `${name}.wgId`, nextDueAt: `${name}.nextDueAt` },
		]),
	);
	const choreQuery = {};
	const db = {
		select: () => ({
			from: (table) => {
				const query = Object.assign(Promise.resolve([]), {
					innerJoin: () => query,
					where: (predicate) => {
						if (table === tables.chores) choreQuery.where = predicate;
						return query;
					},
					orderBy: (order) => {
						if (table === tables.chores) choreQuery.orderBy = order;
						return query;
					},
					limit: (limit) => {
						if (table === tables.chores) choreQuery.limit = limit;
						return query;
					},
				});
				return query;
			},
		}),
	};
	const { GET } = loadTs('src/app/api/wg/[code]/activity/route.ts', {
		'@/core/db': { db, ...tables },
		'@/core/guards/require-wg-member': {
			requireWgMember: async () => ({ ok: true, wg: { id: 'wg-1' } }),
		},
		'@/core/guards/with-wg-route': {
			withWgRoute: (_name, handler) => (req) => handler(req, { code: 'MTE8PZAT' }),
		},
		'@/core/reads/activity': {
			buildActivityTimeline: () => [],
			getActivityReminders: () => [],
		},
		'drizzle-orm': {
			and: (...parts) => ['and', ...parts],
			asc: (column) => ['asc', column],
			desc: (column) => ['desc', column],
			eq: (...parts) => ['eq', ...parts],
			lte: (column, value) => ['lte', column, value instanceof Date ? 'now' : value],
		},
		'next/server': { NextResponse: Response },
	});

	const response = await GET({});
	assert.equal(response.status, 200);
	assert.deepEqual(choreQuery.orderBy, ['asc', 'chores.nextDueAt']);
	assert.deepEqual(choreQuery.where, [
		'and',
		['eq', 'chores.wgId', 'wg-1'],
		['lte', 'chores.nextDueAt', 'now'],
	]);
	assert.equal(choreQuery.limit, 120);
});
