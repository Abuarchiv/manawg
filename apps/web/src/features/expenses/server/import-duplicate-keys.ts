import 'server-only';
import { eq } from 'drizzle-orm';
import { expenses } from '@/core/db';
import type { DbTransaction } from '@/core/db/transaction';
import { berlinDayKey } from '@/core/utils/berlin-day';

export function buildDuplicateKey(
	date: string,
	description: string,
	amountCents: number,
	paidByMemberId: string,
	currency: string,
): string {
	const key = [date.slice(0, 10), description.trim().toLowerCase(), amountCents, paidByMemberId];
	// EUR import keys already persisted in this four-part format; keep them stable.
	return (currency === 'EUR' ? key : [...key, currency]).join('|');
}

export interface DuplicateState {
	/** How many expenses of the WG share each key: identical real purchases are separate expenses. */
	counts: Map<string, number>;
	/** Storage keys earlier imports already hold; they can have gaps once expenses were deleted. */
	usedKeys: Set<string>;
}

// Reads inside the same transaction as the writes: the duplicate state is the
// yardstick for every row of this import, so it must not be a snapshot taken
// before a concurrent import added rows.
export async function loadDuplicateState(tx: DbTransaction, wgId: string): Promise<DuplicateState> {
	const rows = await tx
		.select({
			occurredAt: expenses.occurredAt,
			description: expenses.description,
			amountCents: expenses.amountCents,
			currency: expenses.currency,
			paidByMemberId: expenses.paidByMemberId,
			importDuplicateKey: expenses.importDuplicateKey,
		})
		.from(expenses)
		.where(eq(expenses.wgId, wgId));
	const counts = new Map<string, number>();
	const usedKeys = new Set<string>();
	for (const r of rows) {
		// The day the expense list shows (Berlin), which is also the day an imported row names.
		const day = berlinDayKey(new Date(r.occurredAt));
		const key = buildDuplicateKey(day, r.description, r.amountCents, r.paidByMemberId, r.currency);
		counts.set(key, (counts.get(key) ?? 0) + 1);
		if (r.importDuplicateKey) usedKeys.add(r.importDuplicateKey);
	}
	return { counts, usedKeys };
}

/** The first of `key`, `key|#2`, `key|#3`, ... that no stored expense uses; claims it. */
export function claimStorageKey(key: string, usedKeys: Set<string>): string {
	let candidate = key;
	for (let n = 2; usedKeys.has(candidate); n += 1) candidate = `${key}|#${n}`;
	usedKeys.add(candidate);
	return candidate;
}
