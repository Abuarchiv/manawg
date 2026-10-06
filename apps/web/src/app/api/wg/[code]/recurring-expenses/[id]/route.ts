import { recordAuditEvent } from '@/core/audit';
import { db, recurringExpenses, wgMembers } from '@/core/db';
import { requireOwnerOrAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	forbidden,
	notFound,
	tooMany,
	unreadableJsonBody,
} from '@/core/http/api-errors';
import { readJsonLimited } from '@/core/http/read-json';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { currencySchema } from '@/core/validators/currency';
import { isRecurringDueAtEditAllowed } from '@/core/validators/recurring-due-date';
import { MAX_SPLITS, RECURRING_INTERVAL_MAX_MONTHS } from '@/features/expenses/expense-constants';
import {
	expenseAmountSchema,
	expenseDescriptionSchema,
	expenseSplitSchema,
} from '@/features/expenses/expense-schemas';
import { checkPaidByGuard } from '@/features/expenses/paid-by-guard';
import {
	addMonthsFromAnchor,
	parseRecurringSplits,
	recurringDueDateMatchesExpected,
	recurringSplitsMatchAmount,
	serializeRecurringExpense,
} from '@/features/expenses/recurring-expenses';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const patchSchema = z.object({
	description: expenseDescriptionSchema.optional(),
	amountCents: expenseAmountSchema.optional(),
	currency: currencySchema.optional(),
	paidByMemberId: z.string().uuid().optional(),
	intervalMonths: z.number().int().min(1).max(RECURRING_INTERVAL_MAX_MONTHS).optional(),
	nextDueAt: z.string().datetime({ offset: true }).optional(),
	splits: z.array(expenseSplitSchema).min(1).max(MAX_SPLITS).optional(),
	paused: z.boolean().optional(),
	/** The due date the editor loaded; a booking since then makes the edit stale. */
	expectedNextDueAt: z.string().datetime({ offset: true }).optional(),
});

function hasDuplicateSplitDebtors(splits: Array<{ debtorMemberId: string }>): boolean {
	const seen = new Set<string>();
	for (const split of splits) {
		if (seen.has(split.debtorMemberId)) return true;
		seen.add(split.debtorMemberId);
	}
	return false;
}

export const GET = withWgRoute<{ id: string }>(
	'recurring-expense GET',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const rows = await db
			.select()
			.from(recurringExpenses)
			.where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.wgId, wgId)))
			.limit(1);
		const row = rows[0];
		if (!row) return notFound('recurring_expense_not_found');
		return NextResponse.json({ recurringExpense: serializeRecurringExpense(row) });
	},
);

export const PATCH = withWgRoute<{ id: string }>(
	'recurring-expense PATCH',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

		let raw: unknown;
		try {
			raw = await readJsonLimited(req);
		} catch (err) {
			return unreadableJsonBody(err);
		}
		const parsed = patchSchema.safeParse(raw);
		if (!parsed.success) {
			const issues = parsed.error.flatten();
			if (issues.fieldErrors.amountCents) return badRequest('amount_invalid');
			if (issues.fieldErrors.currency) return badRequest('currency_invalid');
			if (issues.fieldErrors.description) return badRequest('description_invalid');
			if (issues.fieldErrors.paidByMemberId) return badRequest('member_id_invalid');
			if (issues.fieldErrors.intervalMonths) return badRequest('interval_invalid');
			if (issues.fieldErrors.nextDueAt) return badRequest('due_date_invalid');
			if (issues.fieldErrors.splits) return badRequest('splits_invalid');
			if (issues.fieldErrors.paused) return badRequest('paused_invalid');
			return badRequest('invalid_body');
		}

		if (parsed.data.currency !== undefined && parsed.data.currency !== 'EUR') {
			return badRequest('recurring_currency_unsupported');
		}
		const hasAnyField =
			parsed.data.description !== undefined ||
			parsed.data.amountCents !== undefined ||
			parsed.data.currency !== undefined ||
			parsed.data.paidByMemberId !== undefined ||
			parsed.data.intervalMonths !== undefined ||
			parsed.data.nextDueAt !== undefined ||
			parsed.data.splits !== undefined ||
			parsed.data.paused !== undefined;
		if (!hasAnyField) return badRequest('invalid_body');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const limited = await checkRateLimit(
			wgWriteLimiter,
			`recurring-expense:${wgId}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		const rows = await db
			.select()
			.from(recurringExpenses)
			.where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.wgId, wgId)))
			.limit(1);
		const template = rows[0];
		if (!template) return notFound('recurring_expense_not_found');
		const denied = await requireOwnerOrAdmin(wgId, auth.member, template.createdByMemberId);
		if (denied) return denied;
		if (
			parsed.data.expectedNextDueAt !== undefined &&
			!recurringDueDateMatchesExpected(
				template.nextDueAt.toISOString(),
				parsed.data.expectedNextDueAt,
			)
		) {
			return conflict('recurring_expense_changed', 'recurring_expense_changed');
		}
		if (
			parsed.data.nextDueAt !== undefined &&
			!isRecurringDueAtEditAllowed(parsed.data.nextDueAt, template.nextDueAt)
		) {
			return badRequest('due_date_invalid');
		}

		const onlyPauseRequest =
			parsed.data.paused !== undefined &&
			parsed.data.description === undefined &&
			parsed.data.amountCents === undefined &&
			parsed.data.currency === undefined &&
			parsed.data.paidByMemberId === undefined &&
			parsed.data.intervalMonths === undefined &&
			parsed.data.nextDueAt === undefined &&
			parsed.data.splits === undefined;
		const nextDescription = parsed.data.description ?? template.description;
		const nextAmountCents = parsed.data.amountCents ?? template.amountCents;
		const nextPaidByMemberId = parsed.data.paidByMemberId ?? template.paidByMemberId;
		const nextIntervalMonths = parsed.data.intervalMonths ?? template.intervalMonths;
		const nextDueAt = parsed.data.nextDueAt ? new Date(parsed.data.nextDueAt) : template.nextDueAt;
		const templateSplits = parseRecurringSplits(template.splitsJson);
		const nextSplits = parsed.data.splits ?? templateSplits;
		if (hasDuplicateSplitDebtors(nextSplits)) {
			return badRequest('splits_duplicate_debtor');
		}
		if (!recurringSplitsMatchAmount(nextSplits, nextAmountCents)) {
			return badRequest('splits_sum_mismatch');
		}

		const memberIds = Array.from(
			new Set([nextPaidByMemberId, ...nextSplits.map((split) => split.debtorMemberId)]),
		);
		const memberRows = await db
			.select({ id: wgMembers.id })
			.from(wgMembers)
			.where(
				and(
					eq(wgMembers.wgId, wgId),
					inArray(wgMembers.id, memberIds),
					// Existing subscriptions must remain pausable after a participant leaves.
					...(onlyPauseRequest && parsed.data.paused === true
						? []
						: [isNull(wgMembers.deactivatedAt)]),
				),
			);
		if (memberRows.length !== memberIds.length) return badRequest('member_not_in_wg');
		const existingSplitAmounts = new Map(
			templateSplits.map(
				({ debtorMemberId, amountCents }) => [debtorMemberId, amountCents] as const,
			),
		);
		const hasSplitChange =
			parsed.data.splits !== undefined &&
			(nextSplits.length !== templateSplits.length ||
				nextSplits.some(
					({ debtorMemberId, amountCents }) =>
						existingSplitAmounts.get(debtorMemberId) !== amountCents,
				));
		const hasFinancialChange =
			(parsed.data.amountCents !== undefined && parsed.data.amountCents !== template.amountCents) ||
			(parsed.data.paidByMemberId !== undefined &&
				parsed.data.paidByMemberId !== template.paidByMemberId) ||
			hasSplitChange;
		if (
			hasFinancialChange &&
			!checkPaidByGuard(nextPaidByMemberId, auth.member.memberId, nextSplits).ok
		) {
			return forbidden('paid_by_must_include_caller', 'paid_by_must_include_caller');
		}

		const pauseTransition =
			parsed.data.paused === undefined
				? null
				: parsed.data.paused && !template.pausedAt
					? 'pause'
					: !parsed.data.paused && template.pausedAt
						? 'resume'
						: null;

		// Fortsetzen bucht verpasste Termine nicht nach: der nächste Termin springt
		// auf den ersten Zyklustag ab heute (heute fällig bleibt fällig), sonst legt der Cron jeden Pausenmonat an.
		let resumedDueAt = nextDueAt;
		if (pauseTransition === 'resume' && parsed.data.nextDueAt === undefined) {
			const anchorDay = (template.anchorAt ?? template.nextDueAt).getUTCDate();
			const today = new Date();
			today.setUTCHours(0, 0, 0, 0);
			while (resumedDueAt < today) {
				resumedDueAt = addMonthsFromAnchor(resumedDueAt, anchorDay, nextIntervalMonths);
			}
		}

		const nextPausedAt =
			pauseTransition === 'pause'
				? new Date()
				: pauseTransition === 'resume'
					? null
					: template.pausedAt;

		if (onlyPauseRequest && pauseTransition === null) {
			return NextResponse.json({ recurringExpense: serializeRecurringExpense(template) });
		}

		const updateWhere =
			pauseTransition === 'pause'
				? and(
						eq(recurringExpenses.id, id),
						eq(recurringExpenses.wgId, wgId),
						isNull(recurringExpenses.pausedAt),
					)
				: pauseTransition === 'resume'
					? and(
							eq(recurringExpenses.id, id),
							eq(recurringExpenses.wgId, wgId),
							isNotNull(recurringExpenses.pausedAt),
						)
					: and(
							eq(recurringExpenses.id, id),
							eq(recurringExpenses.wgId, wgId),
							// Compare-and-set: a concurrent booking must not be undone.
							eq(recurringExpenses.nextDueAt, template.nextDueAt),
						);
		const updateValues = {
			description: nextDescription,
			amountCents: nextAmountCents,
			paidByMemberId: nextPaidByMemberId,
			intervalMonths: nextIntervalMonths,
			nextDueAt: resumedDueAt,
			// Ein verschobener Termin setzt den Zyklus-Anker neu, sonst springt der
			// nächste Cron-Lauf auf den alten Monatstag zurück.
			...(parsed.data.nextDueAt !== undefined &&
			nextDueAt.getTime() !== template.nextDueAt.getTime()
				? { anchorAt: nextDueAt }
				: {}),
			splitsJson: JSON.stringify(nextSplits),
			updatedAt: new Date(),
			...(pauseTransition !== null ? { pausedAt: nextPausedAt } : {}),
		};

		const [updated] = await db
			.update(recurringExpenses)
			.set(updateValues)
			.where(updateWhere)
			.returning();
		if (!updated) {
			const currentRows = await db
				.select()
				.from(recurringExpenses)
				.where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.wgId, wgId)))
				.limit(1);
			const current = currentRows[0];
			if (!current) return notFound('recurring_expense_not_found');
			if (pauseTransition === null) {
				return conflict('recurring_expense_changed', 'recurring_expense_changed');
			}
			return NextResponse.json({ recurringExpense: serializeRecurringExpense(current) });
		}

		const eventType =
			pauseTransition === 'pause'
				? 'recurring.paused'
				: pauseTransition === 'resume'
					? 'recurring.resumed'
					: 'recurring.updated';
		const summary =
			pauseTransition === 'pause'
				? `${auth.member.name} hat die Fixkosten ${updated.description} pausiert.`
				: pauseTransition === 'resume'
					? `${auth.member.name} hat die Fixkosten ${updated.description} reaktiviert.`
					: `${auth.member.name} hat die Fixkosten-Vorlage ${updated.description} aktualisiert.`;

		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType,
			entityType: 'recurring_expense',
			entityId: updated.id,
			summary,
			metadata: {
				description: updated.description,
				amountCents: updated.amountCents,
				currency: 'EUR',
				intervalMonths: updated.intervalMonths,
				nextDueAt: updated.nextDueAt.toISOString(),
				pausedAt: updated.pausedAt?.toISOString() ?? null,
				splitCount: nextSplits.length,
			},
		});
		return NextResponse.json({ recurringExpense: serializeRecurringExpense(updated) });
	},
);

export const DELETE = withWgRoute<{ id: string }>(
	'recurring-expense DELETE',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const limited = await checkRateLimit(
			wgWriteLimiter,
			`recurring-expense:${wgId}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		const rows = await db
			.select({
				id: recurringExpenses.id,
				createdByMemberId: recurringExpenses.createdByMemberId,
				description: recurringExpenses.description,
				amountCents: recurringExpenses.amountCents,
				intervalMonths: recurringExpenses.intervalMonths,
				nextDueAt: recurringExpenses.nextDueAt,
			})
			.from(recurringExpenses)
			.where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.wgId, wgId)))
			.limit(1);
		const template = rows[0];
		if (!template) return notFound('recurring_expense_not_found');
		const denied = await requireOwnerOrAdmin(wgId, auth.member, template.createdByMemberId);
		if (denied) return denied;

		const deleted = await db
			.delete(recurringExpenses)
			.where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.wgId, wgId)))
			.returning({ id: recurringExpenses.id });
		if (deleted.length === 0) return notFound('recurring_expense_not_found');

		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'recurring.deleted',
			entityType: 'recurring_expense',
			entityId: template.id,
			summary: `${auth.member.name} hat die Fixkosten-Vorlage ${template.description} gelöscht.`,
			metadata: {
				description: template.description,
				amountCents: template.amountCents,
				currency: 'EUR',
				intervalMonths: template.intervalMonths,
				nextDueAt: template.nextDueAt.toISOString(),
			},
		});
		return NextResponse.json({ deleted: true });
	},
);
