import 'server-only';

import { shoppingItems } from '@/core/db';
import type { ReplayCodec } from '@/core/db/idempotent-write';
import type { ShoppingItem } from '@/core/db/schema';
import type { DbTransaction } from '@/core/db/transaction';
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

export const SHOPPING_CREATE_DUPLICATE_RESPONSE = {
	status: 409,
	body: { error: 'shopping_item_duplicate' },
} as const satisfies ShoppingCreateReplayResponse;

export function shoppingCreateHttpResponse(response: ShoppingCreateReplayResponse): NextResponse {
	return NextResponse.json(response.body, { status: response.status });
}

/** Stores `{ status, body }`; rows from before the envelope hold the bare body. */
export const shoppingCreateCodec: ReplayCodec<unknown> = {
	encode: (response) => ({ status: response.status, body: response.body }),
	decode: normalizeShoppingCreateReplayResponse,
};

export interface ShoppingCreateInput {
	wgId: string;
	addedByMemberId: string;
	name: string;
	quantity: string | null;
	bought: boolean;
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

export async function insertShoppingItem(
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
	return item;
}
