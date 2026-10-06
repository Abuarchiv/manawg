import { recordAuditEvent } from '@/core/audit';
import { db, recurringExpenses, wgMembers } from '@/core/db';
import { requireOwnerOrAdmin } from '@/core/guards/admin';
import { badRequest, conflict, forbidden, notFound } from '@/core/http/api-errors';
import { isRecurringDueAtEditAllowed } from '@/core/validators/recurring-due-date';
import { checkPaidByGuard } from '@/features/expenses/paid-by-guard';
import {
	advanceRecurringDue,
	recordRecurringAdvanced,
} from '@/features/expenses/recurring-booking';
import {
	parseRecurringSplits,
	recurringDueDateMatchesExpected,
	serializeRecurringExpense,
} from '@/features/expenses/recurring-expenses';
import { validateSplits } from '@/features/expenses/split-math';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

type RecurringTemplate = typeof recurringExpenses.$inferSelect;
type Split = { debtorMemberId: string; amountCents: number };

interface Caller {
	wgId: string;
	member: { memberId: string; name: string };
}

export interface RecurringTemplateEdit {
	id: string;
	description?: string | undefined;
	amountCents?: number | undefined;
	paidByMemberId?: string | undefined;
	intervalMonths?: number | undefined;
	nextDueAt?: string | undefined;
	expectedNextDueAt?: string | undefined;
	splits?: Split[] | undefined;
}

function auditMetadata(template: RecurringTemplate, splitCount: number) {
	return {
		description: template.description,
		amountCents: template.amountCents,
		currency: 'EUR',
		intervalMonths: template.intervalMonths,
		nextDueAt: template.nextDueAt.toISOString(),
		splitCount,
	};
}

function hasFinancialChange(
	edit: RecurringTemplateEdit,
	template: RecurringTemplate,
	splits: Split[],
	templateSplits: Split[],
): boolean {
	const existingSplitAmounts = new Map(
		templateSplits.map(({ debtorMemberId, amountCents }) => [debtorMemberId, amountCents] as const),
	);
	const hasSplitChange =
		edit.splits !== undefined &&
		(splits.length !== templateSplits.length ||
			splits.some(
				({ debtorMemberId, amountCents }) =>
					existingSplitAmounts.get(debtorMemberId) !== amountCents,
			));
	return (
		(edit.amountCents !== undefined && edit.amountCents !== template.amountCents) ||
		(edit.paidByMemberId !== undefined && edit.paidByMemberId !== template.paidByMemberId) ||
		hasSplitChange
	);
}

/**
 * Edit a template. That is the owner's (or admin's) call, and it is a compare-and-set on the
 * due date: an editor that loaded an older due date, or a booking (cron or "Erfassen") that
 * moved it meanwhile, must not get the stale date written back.
 */
export async function editRecurringTemplate(
	caller: Caller,
	template: RecurringTemplate,
	edit: RecurringTemplateEdit,
): Promise<NextResponse> {
	const { wgId, member } = caller;
	const denied = await requireOwnerOrAdmin(wgId, member, template.createdByMemberId);
	if (denied) return denied;
	if (
		edit.expectedNextDueAt !== undefined &&
		!recurringDueDateMatchesExpected(template.nextDueAt.toISOString(), edit.expectedNextDueAt)
	) {
		return conflict('recurring_expense_changed', 'recurring_expense_changed');
	}
	if (
		edit.nextDueAt !== undefined &&
		!isRecurringDueAtEditAllowed(edit.nextDueAt, template.nextDueAt)
	) {
		return badRequest('due_date_invalid');
	}
	const paidByMemberId = edit.paidByMemberId ?? template.paidByMemberId;
	const templateSplits = parseRecurringSplits(template.splitsJson);
	const splits = edit.splits ?? templateSplits;
	const amountCents = edit.amountCents ?? template.amountCents;
	const finalSplitCheck = validateSplits(amountCents, splits);
	if (!finalSplitCheck.ok) {
		switch (finalSplitCheck.reason) {
			case 'empty':
			case 'invalid_amount':
				return badRequest('splits_invalid');
			case 'duplicate_debtor':
				return badRequest('splits_duplicate_debtor');
			case 'sum_mismatch':
				return badRequest('splits_sum_mismatch');
		}
	}
	const memberIds = Array.from(new Set([paidByMemberId, ...splits.map((s) => s.debtorMemberId)]));
	const memberRows = await db
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(
			and(
				eq(wgMembers.wgId, wgId),
				inArray(wgMembers.id, memberIds),
				isNull(wgMembers.deactivatedAt),
			),
		);
	if (memberRows.length !== memberIds.length) return badRequest('member_not_in_wg');
	if (
		hasFinancialChange(edit, template, splits, templateSplits) &&
		!checkPaidByGuard(paidByMemberId, member.memberId, splits).ok
	) {
		return forbidden('paid_by_must_include_caller', 'paid_by_must_include_caller');
	}

	const requestedDueAt = edit.nextDueAt ? new Date(edit.nextDueAt) : null;
	const movedDueAt =
		requestedDueAt &&
		requestedDueAt.toISOString().slice(0, 10) !== template.nextDueAt.toISOString().slice(0, 10)
			? requestedDueAt
			: null;
	const [updated] = await db
		.update(recurringExpenses)
		.set({
			description: edit.description ?? template.description,
			amountCents,
			paidByMemberId,
			intervalMonths: edit.intervalMonths ?? template.intervalMonths,
			nextDueAt: movedDueAt ?? template.nextDueAt,
			// Only a really moved due date re-anchors the cadence. The edit form resends the
			// unchanged date on every save; re-anchoring then would pin a clamped 28.02. as the
			// new anchor day and lose the 31st.
			anchorAt: movedDueAt ?? template.anchorAt ?? template.nextDueAt,
			splitsJson: JSON.stringify(splits),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(recurringExpenses.id, edit.id),
				eq(recurringExpenses.wgId, wgId),
				eq(recurringExpenses.nextDueAt, template.nextDueAt),
			),
		)
		.returning();
	if (!updated) {
		const [stillThere] = await db
			.select({ id: recurringExpenses.id })
			.from(recurringExpenses)
			.where(and(eq(recurringExpenses.id, edit.id), eq(recurringExpenses.wgId, wgId)))
			.limit(1);
		return stillThere
			? conflict('recurring_expense_changed', 'recurring_expense_changed')
			: notFound('recurring_expense_not_found');
	}
	await recordAuditEvent({
		wgId,
		memberId: member.memberId,
		eventType: 'recurring.updated',
		entityType: 'recurring_expense',
		entityId: updated.id,
		summary: `${member.name} hat die Fixkosten-Vorlage ${updated.description} aktualisiert.`,
		metadata: auditMetadata(updated, splits.length),
	});
	return NextResponse.json({ recurringExpense: serializeRecurringExpense(updated) });
}

/**
 * Move a template's due date on by one interval after a member booked the charge. Every member
 * may do this; the compare-and-set on `expectedNextDueAt` keeps two bookings from advancing twice.
 */
export async function advanceRecurringTemplate(
	caller: Caller,
	template: RecurringTemplate,
	expectedNextDueAt: string | undefined,
): Promise<NextResponse> {
	const { wgId, member } = caller;
	if (
		expectedNextDueAt &&
		!recurringDueDateMatchesExpected(template.nextDueAt.toISOString(), expectedNextDueAt)
	) {
		return conflict('recurring_expense_already_advanced');
	}
	if (template.pausedAt) return badRequest('abo_paused');
	const updated = await advanceRecurringDue(db, template);
	if (!updated) {
		const [current] = await db
			.select()
			.from(recurringExpenses)
			.where(and(eq(recurringExpenses.id, template.id), eq(recurringExpenses.wgId, wgId)))
			.limit(1);
		if (!current) return notFound('recurring_expense_not_found');
		if (
			!recurringDueDateMatchesExpected(
				current.nextDueAt.toISOString(),
				template.nextDueAt.toISOString(),
			)
		) {
			return conflict('recurring_expense_already_advanced');
		}
		if (current.pausedAt) return badRequest('abo_paused');
		return conflict('recurring_expense_already_advanced');
	}
	await recordRecurringAdvanced(member.memberId, updated);
	return NextResponse.json({ recurringExpense: serializeRecurringExpense(updated) });
}
