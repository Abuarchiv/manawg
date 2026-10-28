import 'server-only';
import { recordAuditEvent } from '@/core/audit';
import { type db, recurringExpenses } from '@/core/db';
import type { DbTransaction } from '@/core/db/transaction';
import {
	buildRecurringAdvance,
	parseRecurringSplits,
} from '@/features/expenses/recurring-expenses';
import { and, eq, isNull } from 'drizzle-orm';

type RecurringTemplate = typeof recurringExpenses.$inferSelect;

/**
 * Move a template's due date one interval on from the due date it was loaded with. The update
 * is a compare-and-set on that date and on the template being unpaused, so a concurrent booking
 * or pause answers `null` instead of skipping a charge.
 */
export async function advanceRecurringDue(
	client: typeof db | DbTransaction,
	template: RecurringTemplate,
): Promise<RecurringTemplate | null> {
	const advance = buildRecurringAdvance({
		nextDueAt: template.nextDueAt.toISOString(),
		intervalMonths: template.intervalMonths,
		anchorAt: template.anchorAt.toISOString(),
	});
	const [updated] = await client
		.update(recurringExpenses)
		.set(advance)
		.where(
			and(
				eq(recurringExpenses.id, template.id),
				eq(recurringExpenses.wgId, template.wgId),
				eq(recurringExpenses.nextDueAt, template.nextDueAt),
				isNull(recurringExpenses.pausedAt),
			),
		)
		.returning();
	return updated ?? null;
}

/** Audit a template whose due charge was booked and which moved on to its next due date. */
export function recordRecurringAdvanced(memberId: string, updated: RecurringTemplate) {
	return recordAuditEvent({
		wgId: updated.wgId,
		memberId,
		eventType: 'recurring.advanced',
		entityType: 'recurring_expense',
		entityId: updated.id,
		metadata: {
			description: updated.description,
			amountCents: updated.amountCents,
			currency: 'EUR',
			intervalMonths: updated.intervalMonths,
			nextDueAt: updated.nextDueAt.toISOString(),
			splitCount: parseRecurringSplits(updated.splitsJson).length,
			lastCreatedAt: updated.lastCreatedAt?.toISOString() ?? null,
		},
	});
}
