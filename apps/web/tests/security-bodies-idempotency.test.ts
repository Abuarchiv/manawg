import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { toCsv } from '../src/composition/export.ts';
import {
	claimReplaySlot,
	type ReplaySlotDependencies,
	type ReplaySlotResult,
} from '../src/core/guards/replay-slot.ts';
import { serverError } from '../src/core/http/api-errors.ts';
import { readJsonBody } from '../src/core/http/read-json.ts';
import { apiFetch } from '../src/core/infra/api-client.ts';
import { logApiError } from '../src/core/infra/observability.ts';
import { MAX_CSV_BYTES, readImportJsonBody } from '../src/features/expenses/import-body.ts';

// Bounded body reads, idempotency replay and API client / export edge cases around the trust
// boundary.

describe('read json body', () => {
	test('bounded JSON reader rejects oversized bodies before parsing', async () => {
		const valid = await readJsonBody(
			new Request('https://example.invalid', {
				method: 'POST',
				body: JSON.stringify({ ok: true }),
			}),
			128,
		);
		const oversized = await readJsonBody(
			new Request('https://example.invalid', { method: 'POST', body: 'x'.repeat(129) }),
			128,
		);
		const malformed = await readJsonBody(
			new Request('https://example.invalid', { method: 'POST', body: '{' }),
			128,
		);

		assert.deepEqual(valid, { ok: true, body: { ok: true } });
		assert.deepEqual(oversized, { ok: false, reason: 'payload_too_large' });
		assert.deepEqual(malformed, { ok: false, reason: 'invalid_json' });
	});

	test('import body rejects an oversized stream without a Content-Length header', async () => {
		let reads = 0;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				reads += 1;
				controller.enqueue(new Uint8Array(64 * 1024));
			},
			cancel() {
				cancelled = true;
			},
		});
		const request = new Request('https://example.invalid', {
			method: 'POST',
			body,
			duplex: 'half',
		} as RequestInit & { duplex: 'half' });

		assert.equal(request.headers.has('content-length'), false);
		assert.deepEqual(await readImportJsonBody(request), { ok: false, error: 'payload_too_large' });
		assert.equal(cancelled, true);
		assert.ok(reads < Math.ceil((MAX_CSV_BYTES + 16 * 1024) / (64 * 1024)) + 3);
	});
});

describe('idempotency regression', () => {
	type MutationResponse = { id: string };

	const body: MutationResponse = { id: 'winner-response' };
	const noWait = async () => undefined;

	async function mutateIfWinner(
		dependencies: ReplaySlotDependencies<MutationResponse>,
		mutationCount: { value: number },
	): Promise<ReplaySlotResult<MutationResponse>> {
		const slot = await claimReplaySlot('regression', 'same-key', dependencies);
		if (slot.won) mutationCount.value += 1;
		return slot;
	}

	test('idempotency never performs a second mutation for incomplete winners', async () => {
		for (const scenario of ['slow', 'lost-response'] as const) {
			let claimed = false;
			let cached: MutationResponse | null = null;
			const mutationCount = { value: 0 };
			const dependencies: ReplaySlotDependencies<MutationResponse> = {
				claim: async () => {
					if (claimed) return false;
					claimed = true;
					return true;
				},
				read: async () => cached,
				sleep: async () => {
					if (scenario === 'slow') cached = body;
				},
			};

			assert.equal((await mutateIfWinner(dependencies, mutationCount)).won, true, scenario);

			if (scenario === 'slow') {
				assert.deepEqual(
					await mutateIfWinner(dependencies, mutationCount),
					{ won: false, cached: body },
					scenario,
				);
			} else {
				await assert.rejects(
					mutateIfWinner(dependencies, mutationCount),
					{ message: 'idempotency_response_pending' },
					scenario,
				);
			}

			assert.equal(mutationCount.value, 1, scenario);
		}
	});

	test('idempotency claim and cache failures abort before mutation', async () => {
		for (const code of ['idempotency_claim_failed', 'idempotency_cache_read_failed'] as const) {
			const mutationCount = { value: 0 };
			const dependencies: ReplaySlotDependencies<MutationResponse> = {
				claim: async () => {
					if (code === 'idempotency_claim_failed') throw new Error(code);
					return false;
				},
				read: async () => {
					throw new Error(code);
				},
				sleep: noWait,
			};

			for (let attempt = 0; attempt < 2; attempt += 1) {
				await assert.rejects(mutateIfWinner(dependencies, mutationCount), { message: code });
			}
			assert.equal(mutationCount.value, 0);
		}
	});

	test('normal idempotency replay keeps one mutation and exposes retryable 503s', async () => {
		let claimed = false;
		let cached: MutationResponse | null = null;
		const mutationCount = { value: 0 };
		const dependencies: ReplaySlotDependencies<MutationResponse> = {
			claim: async () => {
				if (claimed) return false;
				claimed = true;
				return true;
			},
			read: async () => cached,
			sleep: noWait,
		};

		const first = await mutateIfWinner(dependencies, mutationCount);
		if (first.won) cached = body;
		assert.deepEqual(await mutateIfWinner(dependencies, mutationCount), {
			won: false,
			cached: body,
		});
		assert.equal(mutationCount.value, 1);

		for (const code of [
			'idempotency_claim_failed',
			'idempotency_cache_read_failed',
			'idempotency_response_pending',
		] as const) {
			const response = serverError(new Error(code));
			assert.equal(response.status, 503);
			assert.equal(response.headers.get('Retry-After'), '1');
			assert.deepEqual(await response.json(), {
				error: 'service_unavailable',
				code: 'idempotency_retryable',
			});
		}
	});
});

describe('issue swarm routes', () => {
	test('apiFetch treats non-JSON success responses as ambiguous', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response('not json', {
				status: 200,
				statusText: 'OK',
				headers: { 'content-type': 'text/plain' },
			});
		try {
			assert.deepEqual(await apiFetch('/api/test'), {
				ok: false,
				status: 0,
				error: 'Unerwartete Serverantwort',
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('apiFetch treats malformed JSON success responses as ambiguous', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response('{', {
				status: 200,
				statusText: 'OK',
				headers: { 'content-type': 'application/json' },
			});
		try {
			assert.deepEqual(await apiFetch('/api/test'), {
				ok: false,
				status: 0,
				error: 'Unerwartete Serverantwort',
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('CSV formula guards remain quoted after neutralization', () => {
		assert.equal(toCsv([{ value: '=1+1' }], ['value']), '﻿value\n"\'=1+1"');
	});

	test('CSV opens in German Excel: BOM, semicolons, decimal-comma amounts', () => {
		assert.equal(
			toCsv(
				[
					{ title: 'Müll; "Bad"', amountCents: -1205 },
					{ title: 'x', amountCents: 5 },
				],
				['title', 'amountCents'],
			),
			'﻿title;amount\n"Müll; ""Bad""";-12,05\nx;0,05',
		);
	});

	test('CSV writes all-day events as a plain date, not a Berlin clock time', () => {
		assert.equal(
			toCsv(
				[
					{
						startsAt: '2026-07-05T00:00:00.000Z',
						allDay: true,
						createdAt: '2026-07-01T22:30:00.000Z',
					},
				],
				['startsAt', 'allDay', 'createdAt'],
			),
			// createdAt is a real instant: Berlin time, already 2 July.
			'\uFEFFstartsAt;allDay;createdAt\n2026-07-05;true;2026-07-02 00:30',
		);
	});

	test('CSV writes Berlin local time and readable splits', () => {
		assert.equal(
			toCsv(
				[
					{
						occurredAt: '2026-03-29T22:00:00.000Z',
						note: '2026-03-29T22:00:00.000Z',
						splits: [
							{ debtor: 'Anna', amountCents: 1234 },
							{ debtor: 'Ben', amountCents: 500 },
						],
					},
				],
				['occurredAt', 'note', 'splits'],
			),
			'\uFEFFoccurredAt;note;splits\n2026-03-30 00:00;2026-03-29T22:00:00.000Z;"Anna: 12,34; Ben: 5,00"',
		);
	});

	test('serverError reports a null value safely and retains sanitized route labels', () => {
		const originalError = console.error;
		const calls: unknown[][] = [];
		console.error = (...args: unknown[]) => calls.push(args);
		try {
			const rawMessage = 'private provider response payload';
			const thrown = new Error(rawMessage);
			thrown.name = 'privateDbPassword123';
			const response = serverError(null);
			logApiError('[test route GET]', thrown);

			assert.equal(response.status, 500);
			assert.deepEqual(calls[0], ['[error]', 'Error', {}]);
			assert.deepEqual(calls[1], ['[test route GET]', 'Error']);
			assert.equal(
				calls.flat().some((value) => value instanceof Error),
				false,
			);
			assert.ok(!JSON.stringify(calls).includes(rawMessage));
			assert.ok(!JSON.stringify(calls).includes('privateDbPassword123'));
			assert.ok(!JSON.stringify(calls).includes('server_error'));
		} finally {
			console.error = originalError;
		}
	});
});
