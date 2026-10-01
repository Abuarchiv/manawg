import { db, idempotencyResponses, shoppingItems } from '@/core/db';
import { completeClaimedResponse } from '@/core/db/claimed-response';
import type { ShoppingItem } from '@/core/db/schema';
import type { DbTransaction } from '@/core/db/transaction';
import type { ReplayReservation } from '@/core/guards/idempotency';
import { RESPONSE_REPLAY_TTL_SECONDS } from '@/core/offline/replay-retention';
import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

type ShoppingCreateWarning =
	| null
	| 'notification_delivery_failed'
	| 'notification_delivery_unknown';

export type ShoppingCreateReplayResponse =
	| {
			status: 200;
			body: {
				item: unknown;
				warning: ShoppingCreateWarning;
			};
	  }
	| { status: 409; body: { error: 'shopping_item_duplicate' } };

const shoppingCreateWarningSchema = z
	.enum(['notification_delivery_failed', 'notification_delivery_unknown'])
	.nullable();

const shoppingCreateItemSchema = z.object({
	id: z.string(),
	addedByMemberId: z.string(),
	name: z.string(),
	createdAt: z.string(),
	quantity: z.string().nullable(),
	boughtAt: z.string().nullable(),
	boughtByMemberId: z.string().nullable(),
});

function isShoppingCreateWarning(value: unknown): value is ShoppingCreateWarning {
	return shoppingCreateWarningSchema.safeParse(value).success;
}

function isShoppingCreateItem(value: unknown): boolean {
	return shoppingCreateItemSchema.safeParse(value).success;
}

export function normalizeShoppingCreateReplayResponse(
	value: unknown,
): ShoppingCreateReplayResponse | null {
	if (!value || typeof value !== 'object') return null;
	if ('status' in value && value.status === 200 && 'body' in value) {
		const body = value.body;
		if (
			body &&
			typeof body === 'object' &&
			'item' in body &&
			isShoppingCreateItem(body.item) &&
			'warning' in body &&
			isShoppingCreateWarning(body.warning)
		) {
			return { status: 200, body: { item: body.item, warning: body.warning } };
		}
	}
	if (
		'status' in value &&
		value.status === 409 &&
		'body' in value &&
		value.body &&
		typeof value.body === 'object' &&
		'error' in value.body &&
		value.body.error === 'shopping_item_duplicate'
	) {
		return SHOPPING_CREATE_DUPLICATE_RESPONSE;
	}
	// Preserve replay of 7-day responses written by the pre-envelope route.
	if (
		'item' in value &&
		isShoppingCreateItem(value.item) &&
		'warning' in value &&
		isShoppingCreateWarning(value.warning)
	) {
		return { status: 200, body: { item: value.item, warning: value.warning } };
	}
	return null;
}

export function normalizeShoppingCreateReplayOrReject(
	value: unknown,
	reservation: OwnedShoppingCreateReservation | null,
): ShoppingCreateReplayResponse | null {
	const response = normalizeShoppingCreateReplayResponse(value);
	if (!response) reservation?.reject(new Error('idempotency_response_pending'));
	return response;
}

export const SHOPPING_CREATE_DUPLICATE_RESPONSE = {
	status: 409,
	body: { error: 'shopping_item_duplicate' },
} as const satisfies ShoppingCreateReplayResponse;

export function shoppingCreateHttpResponse(response: ShoppingCreateReplayResponse): NextResponse {
	return NextResponse.json(response.body, { status: response.status });
}

type OwnedShoppingCreateReservation = Extract<
	ReplayReservation<ShoppingCreateReplayResponse>,
	{ owned: true }
>;

export interface ShoppingCreateInput {
	wgId: string;
	addedByMemberId: string;
	name: string;
	quantity: string | null;
	bought: boolean;
	replay?: { scope: string; key: string };
}

export class ShoppingCreateTransactionRollback extends Error {
	constructor(cause: unknown) {
		super('shopping_create_rolled_back', { cause });
		this.name = 'ShoppingCreateTransactionRollback';
	}
}

export function resolveShoppingCreateReplay(
	reservation: OwnedShoppingCreateReservation | null,
	response: ShoppingCreateReplayResponse,
): void {
	reservation?.resolve(response);
}

export async function finalizeShoppingCreateDuplicateReplay(
	reservation: OwnedShoppingCreateReservation | null,
	dependencies: {
		persist: () => Promise<boolean>;
		read: () => Promise<ShoppingCreateReplayResponse | null>;
		release: () => Promise<boolean>;
	},
): Promise<ShoppingCreateReplayResponse | null> {
	try {
		if (await dependencies.persist()) {
			resolveShoppingCreateReplay(reservation, SHOPPING_CREATE_DUPLICATE_RESPONSE);
			return SHOPPING_CREATE_DUPLICATE_RESPONSE;
		}
	} catch {
		// A read distinguishes a failed write from a write that committed but
		// lost its acknowledgement before cleanup is considered.
	}

	try {
		const cached = await dependencies.read();
		if (cached) {
			resolveShoppingCreateReplay(reservation, cached);
			return cached;
		}
	} catch {
		// Keep the placeholder unless a strict cleanup proves it was removed.
	}

	try {
		if (await dependencies.release()) {
			resolveShoppingCreateReplay(reservation, SHOPPING_CREATE_DUPLICATE_RESPONSE);
			return SHOPPING_CREATE_DUPLICATE_RESPONSE;
		}
	} catch {
		// A failed delete leaves the claim unresolved and retries fail closed.
	}

	try {
		const cached = await dependencies.read();
		if (cached) {
			resolveShoppingCreateReplay(reservation, cached);
			return cached;
		}
	} catch {
		// The route returns a retryable response when neither cache nor cleanup is proven.
	}

	reservation?.reject(new Error('idempotency_response_pending'));
	return null;
}

export async function withShoppingCreatePostCommitFallback(
	provisional: ShoppingCreateReplayResponse,
	finalize: () => Promise<ShoppingCreateReplayResponse>,
	onFailure: () => void,
): Promise<ShoppingCreateReplayResponse> {
	try {
		return await finalize();
	} catch {
		try {
			onFailure();
		} catch {
			// Logging must not turn a committed mutation into an error response.
		}
		return provisional;
	}
}

export function persistShoppingCreateReplayResponse(
	tx: DbTransaction,
	scope: string,
	key: string,
	response: ShoppingCreateReplayResponse,
): Promise<boolean> {
	return completeClaimedResponse(tx, scope, key, response);
}

export async function releaseShoppingCreateClaim(scope: string, key: string): Promise<boolean> {
	const rows = await db
		.delete(idempotencyResponses)
		.where(
			and(
				eq(idempotencyResponses.scope, scope),
				eq(idempotencyResponses.key, key),
				sql`${idempotencyResponses.responseBody} @> '{"_claimed": true}'::jsonb`,
			),
		)
		.returning({ key: idempotencyResponses.key });
	return rows.length > 0;
}

export async function handleShoppingCreateTransactionFailure(
	reservation: OwnedShoppingCreateReservation | null,
	error: unknown,
	releaseClaim: () => Promise<boolean>,
): Promise<'rolled_back' | 'unknown_commit'> {
	reservation?.reject(error);
	if (!(error instanceof ShoppingCreateTransactionRollback)) return 'unknown_commit';
	return (await releaseClaim()) ? 'rolled_back' : 'unknown_commit';
}

export async function insertShoppingItemWithReplay(
	tx: DbTransaction,
	input: ShoppingCreateInput,
): Promise<ShoppingItem | undefined> {
	const [item] = await tx
		.insert(shoppingItems)
		.values({
			wgId: input.wgId,
			addedByMemberId: input.addedByMemberId,
			name: input.name,
			quantity: input.quantity,
			boughtAt: input.bought ? new Date() : null,
			boughtByMemberId: input.bought ? input.addedByMemberId : null,
		})
		.returning();
	if (!item || !input.replay) return item;

	// Commit a safe response with the item. A retry stays replayable if
	// notification delivery or the later response-cache refresh fails.
	const responseBody: ShoppingCreateReplayResponse = {
		status: 200,
		body: { item, warning: 'notification_delivery_unknown' },
	};
	const expiresAt = new Date(Date.now() + RESPONSE_REPLAY_TTL_SECONDS * 1000);
	await tx
		.insert(idempotencyResponses)
		.values({
			scope: input.replay.scope,
			key: input.replay.key,
			responseBody,
			expiresAt,
		})
		.onConflictDoUpdate({
			target: [idempotencyResponses.scope, idempotencyResponses.key],
			set: { responseBody, expiresAt },
		});

	return item;
}
