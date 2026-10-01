import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');

// Pages whose loading logic lives in a feature hook instead of page.tsx.
const LOAD_SOURCES = {
	ausgaben: '../src/features/expenses/hooks/use-expenses-data.ts',
};

function loadCallback(page, scope) {
	const source = readFileSync(
		new URL(LOAD_SOURCES[page] ?? `../src/app/wg/[code]/${page}/page.tsx`, import.meta.url),
		'utf8',
	);
	const file = ts.createSourceFile(
		'page.tsx',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	let callback;
	function visit(node) {
		if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'load') {
			callback = node.initializer.arguments[0];
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	assert.ok(callback, `${page}: load callback exists`);
	const compiled = ts.transpileModule(`const load = ${callback.getText(file)};`, {
		compilerOptions: { target: ts.ScriptTarget.ES2022 },
	}).outputText;
	return new Function(...Object.keys(scope), `${compiled}\nreturn load;`)(...Object.values(scope));
}

function harness(page, result) {
	const state = { loading: false, refreshing: false };
	const requestId = { current: 0 };
	const refresh = () => result;
	const noop = () => {};
	const load = loadCallback(page, {
		hasAbosDataRef: { current: true },
		hasPageCacheRef: { current: true },
		loadRequestIdRef: requestId,
		mountedRef: { current: true },
		isNetworkError: (code, status) => status === 0 || code === 'Netzwerkfehler',
		setLoading: (value) => {
			state.loading = value;
		},
		setInitialLoading: (value) => {
			state.loading = value;
		},
		setRefreshing: (value) => {
			state.refreshing = value;
		},
		refreshAbos: refresh,
		refreshExpenses: refresh,
		refreshRecurringExpenses: refresh,
		refreshReminders: refresh,
		refreshChores: refresh,
		refreshAbsences: refresh,
		setAbos: noop,
		setExpenses: noop,
		setRecurringExpenses: noop,
		setPayments: noop,
		setReminders: noop,
		setItems: noop,
		setMonthCompletions: noop,
		setAbsences: noop,
		setLoadError: noop,
		setLoadErrors: noop,
		setExpensesLoadFailed: noop,
		setRemindersLoadFailed: noop,
		getWgLoadErrorMessage: () => 'Unavailable',
		sortByNextDue: (items) => items,
		syncOfflineActions: async () => 0,
		refreshCount: noop,
		refreshQueuedCount: noop,
		setActionNotice: noop,
		shareCode: 'TESTCODE',
		memberId: 'member',
		captureException: noop,
		wg: { shareCode: 'TESTCODE' },
		identity: { memberId: 'member' },
	});
	return { state, requestId, load };
}

for (const page of ['abos', 'ausgaben', 'mahnungen', 'putzen']) {
	test(`${page}: cached initial refresh settles after success and failure`, async () => {
		for (const ok of [true, false]) {
			const result = {
				ok,
				status: 503,
				error: 'unavailable',
				data: {
					expenses: [],
					recurringExpenses: [],
					payments: [],
					reminders: [],
					chores: [],
					absences: [],
				},
			};
			const { state, load } = harness(page, Promise.resolve(result));
			const pending = load(true);
			assert.equal(state.refreshing, true);
			await pending;
			assert.deepEqual(state, { loading: false, refreshing: false }, `ok=${ok}`);
		}
	});
}

for (const page of ['ausgaben', 'putzen']) {
	test(`${page}: stale response cannot clear a newer refresh`, async () => {
		let resolve;
		const result = new Promise((done) => {
			resolve = done;
		});
		const { state, requestId, load } = harness(page, result);
		const pending = load(false);
		requestId.current += 1;
		resolve({ ok: false, status: 503, error: 'unavailable' });
		await pending;
		assert.equal(state.refreshing, true);
	});
}
