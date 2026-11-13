export interface ExpenseShare {
	debtorMemberId: string;
	amountCents: number;
}

interface ExpenseVersion {
	amountCents: number;
	occurredAt: Date;
	shares: ExpenseShare[];
}

function byMember(shares: ExpenseShare[]): Map<string, number> {
	return new Map(shares.map((share) => [share.debtorMemberId, share.amountCents]));
}

function group<T extends { memberId: string }>(
	entries: T[],
	keyOf: (entry: T) => string,
): Array<{ memberIds: string[]; entry: T }> {
	const groups = new Map<string, { memberIds: string[]; entry: T }>();
	for (const entry of entries) {
		const key = keyOf(entry);
		const found = groups.get(key);
		if (found) found.memberIds.push(entry.memberId);
		else groups.set(key, { memberIds: [entry.memberId], entry });
	}
	return [...groups.values()];
}

/**
 * Who hears about an edit and what their share was and is. An edit only counts when the amount,
 * a share or the date changed; category, description and receipt edits stay silent. Everyone who
 * has a share in the old or the new version is told, except the editor; members with the same
 * change share one notice.
 */
export function expenseUpdateNotices(input: {
	actorId: string;
	before: ExpenseVersion;
	after: ExpenseVersion;
}): Array<{ memberIds: string[]; fromCents: number; toCents: number }> {
	const before = byMember(input.before.shares);
	const after = byMember(input.after.shares);
	const memberIds = [...new Set([...before.keys(), ...after.keys()])];
	const sharesChanged = memberIds.some((id) => (before.get(id) ?? 0) !== (after.get(id) ?? 0));
	const changed =
		sharesChanged ||
		input.before.amountCents !== input.after.amountCents ||
		input.before.occurredAt.getTime() !== input.after.occurredAt.getTime();
	if (!changed) return [];
	const entries = memberIds
		.filter((id) => id !== input.actorId)
		.map((memberId) => ({
			memberId,
			fromCents: before.get(memberId) ?? 0,
			toCents: after.get(memberId) ?? 0,
		}));
	return group(entries, (e) => `${e.fromCents}:${e.toCents}`).map(({ memberIds: ids, entry }) => ({
		memberIds: ids,
		fromCents: entry.fromCents,
		toCents: entry.toCents,
	}));
}

/**
 * Who hears about a deletion and by how much their balance moves: a debtor owes less by their own share,
 * the payer is owed less by what everyone else owed them. The editor and members without a change are left out.
 */
export function expenseDeletionNotices(input: {
	actorId: string;
	payerId: string;
	shares: ExpenseShare[];
}): Array<{ memberIds: string[]; amountCents: number; payer: boolean }> {
	const owedToPayer = input.shares
		.filter((share) => share.debtorMemberId !== input.payerId)
		.reduce((sum, share) => sum + share.amountCents, 0);
	const entries = [
		{ memberId: input.payerId, amountCents: owedToPayer, payer: true },
		...input.shares
			.filter((share) => share.debtorMemberId !== input.payerId)
			.map((share) => ({
				memberId: share.debtorMemberId,
				amountCents: share.amountCents,
				payer: false,
			})),
	].filter((entry) => entry.memberId !== input.actorId && entry.amountCents > 0);
	// The wording differs by role (owes less vs is owed less), so the roles never share a notice.
	return group(entries, (e) => `${e.payer}:${e.amountCents}`).map(({ memberIds, entry }) => ({
		memberIds,
		amountCents: entry.amountCents,
		payer: entry.payer,
	}));
}
