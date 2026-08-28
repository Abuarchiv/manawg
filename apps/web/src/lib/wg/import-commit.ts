import { recordAuditEvent } from '@/core/audit';
import { announcements, db, expenseImports, expenseSplits, expenses, wgMembers } from '@/core/db';
import type { DbTransaction } from '@/core/db/transaction';
import { withTransaction } from '@/core/db/transaction';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { formatEuroCents } from '@/core/utils/money';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ImportSource, ParsedExpense } from './import-parsers';

interface CommitInput {
	wg: { id: string; name: string; shareCode: string };
	source: ImportSource;
	importedByMemberId: string;
	importedByName: string;
	expenses: ReadonlyArray<{ parsed: ParsedExpense; skip: boolean }>;
	mapping: Readonly<Record<string, string | null>>;
	skipDuplicates: boolean;
	rawPayloadHash: string;
}

export interface CommitResult {
	importId: string;
	inserted: number;
	skipped: number;
	errors: Array<{ index: number; reason: string }>;
}

function buildDuplicateKey(
	date: string,
	description: string,
	amountCents: number,
	paidByMemberId: string,
): string {
	return [date.slice(0, 10), description.trim().toLowerCase(), amountCents, paidByMemberId].join(
		'|',
	);
}

// Reads inside the same transaction as the writes: the duplicate keys are the
// yardstick for every row of this import, so they must not be a snapshot taken
// before a concurrent import added rows.
async function loadDuplicateKeys(tx: DbTransaction, wgId: string): Promise<Set<string>> {
	const rows = await tx
		.select({
			occurredAt: expenses.occurredAt,
			description: expenses.description,
			amountCents: expenses.amountCents,
			paidByMemberId: expenses.paidByMemberId,
		})
		.from(expenses)
		.where(eq(expenses.wgId, wgId));
	const set = new Set<string>();
	for (const r of rows) {
		const iso =
			r.occurredAt instanceof Date
				? r.occurredAt.toISOString()
				: new Date(r.occurredAt).toISOString();
		set.add(buildDuplicateKey(iso, r.description, r.amountCents, r.paidByMemberId));
	}
	return set;
}

/**
 * Every member the file refers to must belong to this WG. Checked before the
 * import row exists, because a mapping to a stranger is the caller's mistake,
 * not a half-finished import.
 */
async function assertMembersInWg(input: CommitInput): Promise<void> {
	const memberIds = new Set<string>();
	for (const item of input.expenses) {
		const paid = input.mapping[item.parsed.paidByName];
		if (paid) memberIds.add(paid);
		for (const split of item.parsed.splits) {
			const mapped = input.mapping[split.memberName];
			if (mapped) memberIds.add(mapped);
		}
	}
	const memberIdsList = Array.from(memberIds);
	if (memberIdsList.length === 0) return;

	const memberRows = await db
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(and(eq(wgMembers.wgId, input.wg.id), inArray(wgMembers.id, memberIdsList)));
	const validIds = new Set(memberRows.map((m) => m.id));
	for (const id of memberIdsList) {
		if (!validIds.has(id)) throw new Error('member_not_in_wg');
	}
}

type SplitRow = { debtorMemberId: string; amountCents: number };

type PreparedRow =
	| { ok: true; paidByMemberId: string; splitRows: SplitRow[]; duplicateKey: string }
	| { ok: false; reason: string };

/**
 * Turns one parsed row into what the insert needs, or into the reason why it
 * cannot be inserted. A rejected row is reported back to the user and does not
 * abort the import — only a failing database call does.
 */
function prepareRow(input: CommitInput, parsed: ParsedExpense): PreparedRow {
	const paidByMemberId = input.mapping[parsed.paidByName];
	if (!paidByMemberId) return { ok: false, reason: 'payer_unmapped' };

	const splitRows = parsed.splits
		.map((s) => ({ debtorMemberId: input.mapping[s.memberName], amountCents: s.amountCents }))
		.filter((s): s is SplitRow => Boolean(s.debtorMemberId));
	if (splitRows.length === 0) return { ok: false, reason: 'no_valid_splits' };

	const splitSum = splitRows.reduce((acc, s) => acc + s.amountCents, 0);
	if (splitSum !== parsed.amountCents) return { ok: false, reason: 'split_sum_mismatch' };

	return {
		ok: true,
		paidByMemberId,
		splitRows,
		duplicateKey: buildDuplicateKey(
			parsed.date,
			parsed.description,
			parsed.amountCents,
			paidByMemberId,
		),
	};
}

interface ImportWriteResult {
	importId: string;
	inserted: number;
	skipped: number;
	errors: Array<{ index: number; reason: string }>;
	totalAmountCents: number;
}

/**
 * Writes the import row, every accepted expense with its splits and the final
 * counters. Runs inside one transaction, so a failure anywhere leaves the WG
 * exactly as it was: an expense without splits, or expenses without the import
 * row that documents where they came from, would both be wrong balances.
 */
async function writeImport(tx: DbTransaction, input: CommitInput): Promise<ImportWriteResult> {
	const [imp] = await tx
		.insert(expenseImports)
		.values({
			wgId: input.wg.id,
			source: input.source,
			importedByMemberId: input.importedByMemberId,
			rowCountTotal: input.expenses.length,
			rawPayloadHash: input.rawPayloadHash,
			memberMapping: input.mapping as unknown as Record<string, unknown>,
		})
		.returning({ id: expenseImports.id });
	if (!imp) throw new Error('import_insert_failed');

	const errors: Array<{ index: number; reason: string }> = [];
	let inserted = 0;
	let skipped = 0;
	let totalAmountCents = 0;

	const duplicateKeys = input.skipDuplicates
		? await loadDuplicateKeys(tx, input.wg.id)
		: new Set<string>();

	for (let i = 0; i < input.expenses.length; i += 1) {
		const item = input.expenses[i];
		if (!item) continue;
		if (item.skip) {
			skipped += 1;
			continue;
		}
		const parsed = item.parsed;
		const prepared = prepareRow(input, parsed);
		if (!prepared.ok) {
			errors.push({ index: i, reason: prepared.reason });
			continue;
		}
		if (input.skipDuplicates && duplicateKeys.has(prepared.duplicateKey)) {
			skipped += 1;
			continue;
		}

		const expenseInsert = tx.insert(expenses).values({
			wgId: input.wg.id,
			paidByMemberId: prepared.paidByMemberId,
			amountCents: parsed.amountCents,
			currency: parsed.currency,
			description: parsed.description,
			importId: imp.id,
			importDuplicateKey: input.skipDuplicates ? prepared.duplicateKey : null,
			occurredAt: new Date(parsed.date),
		});
		const [row] = input.skipDuplicates
			? await expenseInsert
					.onConflictDoNothing({
						target: [expenses.wgId, expenses.importDuplicateKey],
						where: sql`${expenses.importDuplicateKey} IS NOT NULL`,
					})
					.returning({ id: expenses.id })
			: await expenseInsert.returning({ id: expenses.id });
		if (!row) {
			if (input.skipDuplicates) {
				skipped += 1;
				duplicateKeys.add(prepared.duplicateKey);
			} else {
				errors.push({ index: i, reason: 'insert_failed' });
			}
			continue;
		}

		await tx.insert(expenseSplits).values(
			prepared.splitRows.map((s) => ({
				expenseId: row.id,
				debtorMemberId: s.debtorMemberId,
				amountCents: s.amountCents,
			})),
		);
		inserted += 1;
		totalAmountCents += parsed.amountCents;
		duplicateKeys.add(prepared.duplicateKey);
	}

	await tx
		.update(expenseImports)
		.set({
			rowCountInserted: inserted,
			rowCountSkipped: skipped,
			errorCount: errors.length,
			finishedAt: new Date(),
		})
		.where(eq(expenseImports.id, imp.id));

	return { importId: imp.id, inserted, skipped, errors, totalAmountCents };
}

export async function commitImport(input: CommitInput): Promise<CommitResult> {
	await assertMembersInWg(input);

	// The whole import is one transaction. It used to be a sequence of separate
	// statements with a hand-written repair on failure: delete the expenses
	// already written, delete the import row, both with `.catch(() => undefined)`
	// on top. That repair is itself a database call, and swallowing its failure
	// meant a half-written import stayed in the WG while the caller only saw an
	// error and imported the same file again.
	const { importId, inserted, skipped, errors, totalAmountCents } = await withTransaction((tx) =>
		writeImport(tx, input),
	);

	// Everything below is deliberately outside the transaction: it informs the
	// WG about an import that already happened, so a failure here must not undo
	// the import itself.
	try {
		await db.insert(announcements).values({
			wgId: input.wg.id,
			authorMemberId: input.importedByMemberId,
			kind: 'info',
			source: 'expense',
			content: `${input.importedByName} hat ${inserted} Ausgaben importiert (${input.source}).`,
		});
	} catch (announcementErr) {
		console.warn('[import-commit] announcement failed', announcementErr);
	}

	await recordAuditEvent({
		wgId: input.wg.id,
		memberId: input.importedByMemberId,
		eventType: 'import.completed',
		entityType: 'expense_import',
		entityId: importId,
		summary: `${input.importedByName} hat ${inserted} Ausgaben importiert.`,
		metadata: {
			source: input.source,
			inserted,
			skipped,
			errorCount: errors.length,
			totalAmountCents,
		},
	});

	void dispatchNotification({
		wg: input.wg,
		event: 'import.completed',
		payload: {
			actorName: input.importedByName,
			inserted,
			totalAmountCents,
			amountFormatted: formatEuroCents(totalAmountCents),
		},
		excludeMemberId: input.importedByMemberId,
	}).catch((err) => console.error('[import-commit] notification failed', err));

	return { importId, inserted, skipped, errors };
}
