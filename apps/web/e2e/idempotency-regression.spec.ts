import { expect, test } from '@playwright/test';
import {
	type ReplaySlotDependencies,
	type ReplaySlotResult,
	claimReplaySlot,
} from '../src/core/guards/replay-slot';
import { serverError } from '../src/core/http/api-errors';

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
		await test.step(scenario, async () => {
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

			await expect(mutateIfWinner(dependencies, mutationCount)).resolves.toMatchObject({
				won: true,
			});

			if (scenario === 'slow') {
				await expect(mutateIfWinner(dependencies, mutationCount)).resolves.toEqual({
					won: false,
					cached: body,
				});
			} else {
				await expect(mutateIfWinner(dependencies, mutationCount)).rejects.toMatchObject({
					message: 'idempotency_response_pending',
				});
			}

			expect(mutationCount.value).toBe(1);
		});
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
			await expect(mutateIfWinner(dependencies, mutationCount)).rejects.toMatchObject({
				message: code,
			});
		}
		expect(mutationCount.value).toBe(0);
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
	await expect(mutateIfWinner(dependencies, mutationCount)).resolves.toEqual({
		won: false,
		cached: body,
	});
	expect(mutationCount.value).toBe(1);

	for (const code of [
		'idempotency_claim_failed',
		'idempotency_cache_read_failed',
		'idempotency_response_pending',
	] as const) {
		const response = serverError(new Error(code));
		expect(response.status).toBe(503);
		expect(response.headers.get('Retry-After')).toBe('1');
		expect(await response.json()).toEqual({
			error: 'service_unavailable',
			code: 'idempotency_retryable',
		});
	}
});
