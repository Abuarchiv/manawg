import {
	completeClaimedResponse,
	lockClaimedResponse,
	releaseClaimedResponse,
	releaseLockedClaim,
} from '@/core/db/claimed-response';
import { type DbTransaction, TransactionAbort, withTransaction } from '@/core/db/transaction';
import { claimReplaySlot } from '@/core/guards/replay-slot';
import { claimResponseSlot, getCachedResponse } from '@/core/idempotency-store';
import { logApiError } from '@/core/infra/observability';

/**
 * The one entry point for mutations that accept an `Idempotency-Key`.
 *
 * With a key, a write runs at most once per `(scope, key)`:
 *
 * 1. A stored response is replayed before any other work (`prepare` included).
 * 2. `prepare` runs: checks that must pass before the claim, such as rate limits.
 * 3. The key is claimed in Postgres. A request that loses the claim polls until
 *    the winner's response is stored and replays it.
 * 4. One transaction locks the claim, runs the write and stores its response
 *    (only statuses accepted by `storeStatus`), so the response commits
 *    atomically with the write. Other statuses delete the claim in the same
 *    transaction, so a retry runs again.
 * 5. When the transaction fails, the claim is released with the lease it held;
 *    a request whose lease ran out can never delete another request's claim.
 *
 * Claim and store errors fail closed: they throw, and the caller answers with
 * a retryable error instead of writing without protection. Without a key the
 * write runs in a plain transaction. Side effects that must not roll back the
 * write (audit, push) belong after this call, for `written` results only.
 */

/** A response as the route answers it and as a replay reproduces it. */
export interface StoredResponse<B = unknown> {
	status: number;
	body: B;
}

/** How a route's responses are stored in the claim row and read back. */
export interface ReplayCodec<B> {
	encode(response: StoredResponse<B>): object;
	/** The response a stored row replays, or `null` when the row is not this route's. */
	decode(stored: unknown): StoredResponse<B> | null;
}

function readStoredResponse(value: unknown): StoredResponse | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	if (
		typeof row.status === 'number' &&
		Number.isInteger(row.status) &&
		row.status >= 200 &&
		row.status <= 599 &&
		'body' in row
	) {
		return { status: row.status, body: row.body };
	}
	return null;
}

/**
 * Stores `{ status, body }`. `legacy` reads rows written in an older format
 * that are still inside the replay window.
 */
export function responseCodec<B = unknown>(
	legacy?: (stored: object) => StoredResponse<B> | null,
): ReplayCodec<B> {
	return {
		encode: (response) => ({ status: response.status, body: response.body }),
		decode: (stored) => {
			const response = readStoredResponse(stored) as StoredResponse<B> | null;
			if (response) return response;
			return stored && typeof stored === 'object' ? (legacy?.(stored) ?? null) : null;
		},
	};
}

/** Stores the bare body; replays answer with `status`. */
export function bodyCodec<B extends object>(
	isBody: (stored: unknown) => stored is B,
	status = 200,
): ReplayCodec<B> {
	return {
		encode: (response) => response.body,
		decode: (stored) => (isBody(stored) ? { status, body: stored } : null),
	};
}

/** What a write returns: its response, plus context for the route's work after commit. */
export interface WriteOutcome<B = unknown, C = unknown> extends StoredResponse<B> {
	context?: C;
}

type AnyOutcome = { status: number; body: unknown; context?: unknown };

/** The union of the contexts a write can return. */
type ContextOf<O> = O extends unknown
	? 'context' extends keyof O
		? Exclude<O['context' & keyof O], undefined>
		: never
	: never;

export type Rejected<R> = { rejected: R };

/**
 * An outcome the route answers with `response` itself, such as a lost compare-and-set. With the
 * default `storeStatus` it is not stored, so the same key can run again.
 */
export function rejectWrite<R extends { status: number }>(
	response: R,
): { status: number; body: null; context: Rejected<R> } {
	return { status: response.status, body: null, context: { rejected: response } };
}

export type WriteFn<O extends AnyOutcome, I> = (tx: DbTransaction, input: I) => Promise<O>;

export type Prepared<I, S> = { stop: S } | { input: I };

export type IdempotentWriteResult<O extends AnyOutcome, S = never> =
	| ({ kind: 'replayed' } & StoredResponse)
	| { kind: 'written'; status: number; body: O['body']; context: ContextOf<O> | undefined }
	// Without a `prepare` or `beforeReplay` that can stop, callers need not handle `stopped`.
	| ([S] extends [never] ? never : Stopped<S>);

type Stopped<S> = { kind: 'stopped'; response: S };

export interface IdempotentWriteOptions<O extends AnyOutcome, I, S> {
	/** Namespace of the key; include the WG, the member and the route. */
	scope: string;
	key: string | null;
	codec: ReplayCodec<unknown>;
	/** Statuses kept for replay; any other outcome releases the claim. Default: 2xx. */
	storeStatus?: (status: number) => boolean;
	/** Runs after a replay lookup missed and before the claim. `stop` ends the request. */
	prepare?: () => Promise<Prepared<I, S>>;
	/**
	 * Runs before a replay found outside the write transaction (the early lookup and
	 * a lost claim); a non-null result is answered instead of the stored response.
	 */
	beforeReplay?: () => Promise<S | null>;
	/**
	 * Opens the transaction. Locks that must precede the claim row lock (for example
	 * `lockExpensePayments`) are taken here. Default: `withTransaction`.
	 */
	inTransaction?: <R>(work: (tx: DbTransaction) => Promise<R>) => Promise<R>;
	/**
	 * Called after the transaction failed. Returning a write runs it in a new
	 * transaction under the same claim (e.g. replaying a row a unique index found);
	 * `null` releases the claim and rethrows.
	 */
	retryAfterRollback?: (error: unknown, attempt: number) => WriteFn<O, I> | null;
	/** `TransactionAbort` code thrown when the response cannot be stored. */
	completeFailureCode?: string;
	/**
	 * Responses whose JSON exceeds this size are stored as replay-unavailable. Default 32 KiB;
	 * `null` keeps every response (an import result must replay however many rows it lists).
	 */
	maxStoredBytes?: number | null;
}

function isSuccessStatus(status: number): boolean {
	return status >= 200 && status < 300;
}

export async function withIdempotentWrite<O extends AnyOutcome, I = undefined, S = never>(
	options: IdempotentWriteOptions<O, I, S>,
	write: WriteFn<O, I>,
): Promise<IdempotentWriteResult<O, S>> {
	type Result = IdempotentWriteResult<O, S>;
	const { scope, key, codec } = options;
	const storeStatus = options.storeStatus ?? isSuccessStatus;
	const inTransaction = options.inTransaction ?? withTransaction;

	const stopped = (response: S) => ({ kind: 'stopped', response }) as Stopped<S> as Result;
	const replay = async (stored: unknown): Promise<Result> => {
		const blocked = await options.beforeReplay?.();
		if (blocked !== undefined && blocked !== null) return stopped(blocked);
		const response = codec.decode(stored);
		if (!response) throw new Error('idempotency_response_invalid');
		return { kind: 'replayed', ...response };
	};

	if (key) {
		const cached = await getCachedResponse<unknown>(scope, key);
		if (cached !== null) return replay(cached);
	}

	let input = undefined as I;
	if (options.prepare) {
		const prepared = await options.prepare();
		if ('stop' in prepared) return stopped(prepared.stop);
		input = prepared.input;
	}

	const written = (outcome: O): Result => ({
		kind: 'written',
		status: outcome.status,
		body: outcome.body,
		context: outcome.context as ContextOf<O> | undefined,
	});

	if (!key) return written(await inTransaction((tx) => write(tx, input)));

	const slot = await claimReplaySlot<unknown>(scope, key, {
		claim: claimResponseSlot,
		read: getCachedResponse,
	});
	if (!slot.won) return replay(slot.cached);

	const isStored = (body: unknown): body is unknown => codec.decode(body) !== null;
	const claim: { lease: Date | null } = { lease: null };
	let attemptWrite = write;
	for (let attempt = 1; ; attempt += 1) {
		try {
			const result = await inTransaction(async (tx) => {
				const locked = await lockClaimedResponse(tx, scope, key, isStored);
				if (locked.kind === 'completed') {
					const response = codec.decode(locked.body);
					if (!response) throw new TransactionAbort('idempotency_claim_invalid');
					return { replayed: response };
				}
				// A retry must still hold the lease it started with; a different one means
				// the claim expired and another request owns the key now.
				if (claim.lease && claim.lease.getTime() !== locked.leaseExpiresAt.getTime()) {
					throw new TransactionAbort('idempotency_claim_invalid');
				}
				claim.lease = locked.leaseExpiresAt;
				const outcome = await attemptWrite(tx, input);
				if (storeStatus(outcome.status)) {
					await storeResponse(
						tx,
						{ scope, key, lease: locked.leaseExpiresAt },
						codec.encode(outcome),
						options,
					);
				} else {
					await releaseLockedClaim(tx, scope, key, locked.leaseExpiresAt);
				}
				return { outcome };
			});
			if ('replayed' in result) return { kind: 'replayed', ...result.replayed };
			return written(result.outcome);
		} catch (error) {
			const retry = options.retryAfterRollback?.(error, attempt) ?? null;
			if (retry) {
				attemptWrite = retry;
				continue;
			}
			// Only the placeholder with this lease is deleted, so this is a no-op when
			// the transaction committed after all.
			if (claim.lease) await releaseClaimedResponse(scope, key, claim.lease);
			throw error;
		}
	}
}

/** 32 KiB easily covers an expense with 50 splits. */
const MAX_STORED_RESPONSE_BYTES = 32 * 1024;
const REPLAY_UNAVAILABLE = { _replayUnavailable: true };

/**
 * Store the response under the claim. A response too large to keep is stored as
 * replay-unavailable, so a retry fails loudly instead of running the write again.
 */
async function storeResponse(
	tx: DbTransaction,
	claim: { scope: string; key: string; lease: Date },
	response: object,
	options: { completeFailureCode?: string; maxStoredBytes?: number | null },
): Promise<void> {
	const failureCode = options.completeFailureCode;
	const maxBytes =
		options.maxStoredBytes === undefined ? MAX_STORED_RESPONSE_BYTES : options.maxStoredBytes;
	let stored = response;
	if (maxBytes !== null && JSON.stringify(response).length > maxBytes) {
		console.warn('[idempotency] response exceeds the replay budget; storing replay-unavailable');
		stored = REPLAY_UNAVAILABLE;
	}
	try {
		await completeClaimedResponse(tx, claim.scope, claim.key, stored, claim.lease);
	} catch (err) {
		if (!failureCode) throw err;
		if (!(err instanceof TransactionAbort)) logApiError('[idempotency] replay write failed', err);
		throw new TransactionAbort(failureCode);
	}
}
