// HTTP and infrastructure contracts: redacted error reporting, bounded body reads, replay slots,
// the API client's handling of ambiguous responses and CSV export safety.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inspect } from 'node:util';
import { toCsv } from '../src/composition/export';
import {
	type ReplaySlotDependencies,
	type ReplaySlotResult,
	claimReplaySlot,
} from '../src/core/guards/replay-slot';
import { serverError } from '../src/core/http/api-errors';
import { readJsonBody } from '../src/core/http/read-json';
import { apiFetch } from '../src/core/infra/api-client';
import { captureException, logApiError } from '../src/core/infra/observability';
import { createPresignedUpload } from '../src/core/infra/s3';
import { MAX_CSV_BYTES, readImportJsonBody } from '../src/features/expenses/import-body';
import { assertMatchObject } from './support/match-object';

describe('api infra security contracts', () => {
	test('central error reporting redacts thrown messages and arbitrary context while keeping route labels', () => {
		const calls: unknown[][] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => calls.push(args);
		try {
			const providerPayload = 'PostgresError: password=private-db-payload';
			captureException(new Error(providerPayload), {
				boundary: 'wg-code',
				query: providerPayload,
				cronJob: 'privatepayload',
			});
			logApiError('[expenses GET]', new Error(providerPayload));

			const output = inspect(calls, { depth: 8 });
			assert.ok(!output.includes(providerPayload));
			assert.ok(!output.includes('privatepayload'));
			assert.ok(!output.includes('query:'));
			assert.ok(output.includes('wg-code'));
			assert.ok(output.includes('[expenses GET]'));
		} finally {
			console.error = original;
		}
	});
});

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

			assertMatchObject(await mutateIfWinner(dependencies, mutationCount), {
				won: true,
			});

			if (scenario === 'slow') {
				assert.deepEqual(await mutateIfWinner(dependencies, mutationCount), {
					won: false,
					cached: body,
				});
			} else {
				await assert.rejects(mutateIfWinner(dependencies, mutationCount), (error) => {
					assertMatchObject(error, {
						message: 'idempotency_response_pending',
					});
					return true;
				});
			}

			assert.equal(mutationCount.value, 1);
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
				await assert.rejects(mutateIfWinner(dependencies, mutationCount), (error) => {
					assertMatchObject(error, {
						message: code,
					});
					return true;
				});
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
		assert.equal(toCsv([{ value: '=1+1' }], ['value']), '\uFEFFvalue\n"\'=1+1"');
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
			'\uFEFFtitle;amount\n"Müll; ""Bad""";-12,05\nx;0,05',
		);
	});

	test('presigned uploads reject path traversal keys before configuration lookup', async () => {
		await assert.rejects(createPresignedUpload('../outside.png', 'image/png', 1), /Invalid S3 key/);
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
