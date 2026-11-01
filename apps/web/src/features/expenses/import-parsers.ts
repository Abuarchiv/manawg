import type { Message } from '@/shared/i18n/message';
import { normalizeMemberName } from './import-csv-helpers';
import type { ParsedExpense } from './import-types';

export { parseSplidCsv } from './import-splid-csv';
export { parseSplitwiseCsv } from './import-splitwise-csv';
export type { ImportSource, ParsedExpense, RejectedRow } from './import-types';
export { UNKNOWN_NAME } from './import-types';

/** Short names differ by one letter all the time (Tom/Tim); only longer ones may be fuzzy. */
function maxFuzzyDistance(length: number): number {
	if (length < 5) return 0;
	return length < 9 ? 1 : 2;
}

const REJECTED_ROW_REASONS: Record<string, Message> = {
	date_invalid: { key: 'expenses-import.rejected.dateInvalid' },
	amount_invalid: { key: 'expenses-import.rejected.amountInvalid' },
	no_participants: { key: 'expenses-import.rejected.noParticipants' },
	payer_missing: { key: 'expenses-import.rejected.payerMissing' },
	multiple_payers: { key: 'expenses-import.rejected.multiplePayers' },
	currency_unsupported: { key: 'expenses-import.rejected.currencyUnsupported' },
};

export function describeRejectedRowReason(reason: string): Message {
	return REJECTED_ROW_REASONS[reason] ?? { key: 'expenses-import.rejected.fallback' };
}

/**
 * A parsed row's `warnings` are internal codes (see `parseSplitwiseCsv`), not
 * UI text. This is the one place that turns them into messages for
 * `ImportPreviewTable`, so a new code can't accidentally leak to the screen
 * unmapped.
 */
export function describeParsedExpenseWarning(code: string): Message {
	if (code.startsWith('unknown_columns_ignored:')) {
		const columns = code.slice('unknown_columns_ignored:'.length).split('|').filter(Boolean);
		const quoted = columns.map(
			(name): Message => ({
				key: 'expenses-import.warnings.quoted',
				values: { name },
			}),
		);
		const list: Message | string =
			quoted.length === 0
				? ''
				: quoted.reduceRight((tail, head) => ({
						key: 'expenses-import.warnings.list',
						values: { head, tail },
					}));
		return {
			key: 'expenses-import.warnings.unknownColumns',
			values: { count: columns.length, columns: list },
		};
	}
	if (code === 'custom_splits_drift_adjusted')
		return { key: 'expenses-import.warnings.splitsDrift' };
	if (code === 'custom_splits_discarded') {
		return { key: 'expenses-import.warnings.splitsDiscarded' };
	}
	if (code === 'payment_row') return { key: 'expenses-import.warnings.paymentRow' };
	if (code === 'ocr_heuristic') return { key: 'expenses-import.warnings.ocr' };
	return { key: 'expenses-import.warnings.fallback' };
}

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	const prev: number[] = new Array(b.length + 1);
	const curr: number[] = new Array(b.length + 1);
	for (let j = 0; j <= b.length; j += 1) prev[j] = j;
	for (let i = 1; i <= a.length; i += 1) {
		curr[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
			const del = (prev[j] ?? 0) + 1;
			const ins = (curr[j - 1] ?? 0) + 1;
			const sub = (prev[j - 1] ?? 0) + cost;
			curr[j] = Math.min(del, ins, sub);
		}
		for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j] ?? 0;
	}
	return prev[b.length] ?? 0;
}

interface MemberRef {
	id: string;
	name: string;
}

/**
 * Maps file names to member ids: exact (normalized) matches first, then a conservative fuzzy
 * match for names no member claimed exactly. Names matched fuzzily are added to `fuzzyNames`
 * so the UI can ask for a check instead of presenting them as certain.
 */
export function matchMembers(
	parsedNames: readonly string[],
	wgMembers: readonly MemberRef[],
	fuzzyNames?: Set<string>,
): Map<string, string | null> {
	const result = new Map<string, string | null>();
	const memberIndex = wgMembers.map((m) => ({
		id: m.id,
		normalized: normalizeMemberName(m.name),
	}));
	const claimedExactly = new Set<string>();
	const pending: Array<{ raw: string; normalized: string }> = [];
	for (const raw of parsedNames) {
		const normalized = normalizeMemberName(raw);
		const exact = normalized ? memberIndex.find((m) => m.normalized === normalized) : undefined;
		if (exact) {
			result.set(raw, exact.id);
			claimedExactly.add(exact.id);
		} else {
			result.set(raw, null);
			if (normalized) pending.push({ raw, normalized });
		}
	}
	for (const { raw, normalized } of pending) {
		let best: { id: string; distance: number; ambiguous: boolean } | null = null;
		for (const m of memberIndex) {
			if (claimedExactly.has(m.id)) continue;
			const maxDistance = maxFuzzyDistance(Math.min(normalized.length, m.normalized.length));
			if (Math.abs(normalized.length - m.normalized.length) > maxDistance) continue;
			const distance = levenshtein(normalized, m.normalized);
			if (distance > maxDistance) continue;
			if (best === null || distance < best.distance) {
				best = { id: m.id, distance, ambiguous: false };
			} else if (distance === best.distance) {
				best.ambiguous = true;
			}
		}
		if (best && !best.ambiguous) {
			result.set(raw, best.id);
			fuzzyNames?.add(raw);
		}
	}
	return result;
}

export function collectUniqueNames(parsed: readonly ParsedExpense[]): string[] {
	const set = new Set<string>();
	for (const e of parsed) {
		if (e.paidByName) set.add(e.paidByName);
		for (const s of e.splits) {
			if (s.memberName) set.add(s.memberName);
		}
	}
	return Array.from(set);
}

export function findMappingConflicts(
	parsed: readonly ParsedExpense[],
	mapping: Readonly<Record<string, string | null>>,
): string[] {
	const conflicts = new Set<string>();
	for (const name of collectUniqueNames(parsed)) {
		if (!Object.hasOwn(mapping, name) || !mapping[name]) conflicts.add(name);
	}
	return Array.from(conflicts);
}
