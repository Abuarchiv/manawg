import { parseTimestamp } from '@/core/utils/time';
import { OFFLINE_NO_CONNECTION_TITLE, explainOfflineActionFailure } from './offline-failure-copy';

export { explainOfflineActionFailure };

export type OfflineActionType =
	| 'shopping.create'
	| 'shopping.update'
	| 'announcement.create'
	| 'absence.create'
	| 'chore.create'
	| 'chore.complete'
	| 'expense.create'
	| 'expense.update'
	| 'recurring.create'
	| 'recurring.advance';

export interface OfflineAction {
	id: string;
	/** Stable UUID used exclusively for server-side replay protection. */
	idempotencyKey?: string;
	type: OfflineActionType;
	wgId?: string;
	shareCode: string;
	memberId: string;
	createdAt: string;
	payload: Record<string, unknown>;
	attempts?: number;
	lastAttemptAt?: string;
	lastError?: string;
}

interface OfflineActionRequest {
	path: string;
	method: 'POST' | 'PATCH';
	body: Record<string, unknown>;
}

interface OfflineActionSummary {
	title: string;
	detail: string;
}

interface OfflineActionRisk {
	title: string;
	detail: string;
}

/**
 * Per-type behavior for the offline queue. Declared here in core rather
 * than split across features/<name>/offline.ts: the queue mechanism itself
 * (types, retry/staleness logic, request building) is one small, cohesive
 * unit, and splitting the ~9 handlers out would need a bootstrap module to
 * import every feature's offline.ts just for its registration side effect —
 * indirection with no reader benefit over this single table.
 *
 * Declared as a `Record<OfflineActionType, OfflineActionHandler>` literal
 * (below) rather than a Map so the compiler enforces that every action type
 * has a handler — add a type to the union and `tsc` fails until its entry
 * is added here, which a Map's runtime `.get()`/`.set()` can't guarantee.
 */
interface OfflineActionHandler {
	buildRequest(action: OfflineAction): OfflineActionRequest;
	summary(action: OfflineAction): OfflineActionSummary;
	/** "Check before resending" hint shown once an action is stale or has already failed once. */
	risk(action: OfflineAction): OfflineActionRisk;
}

interface QueuedIdentityInput {
	wgId?: string;
	shareCode: string;
	memberId: string;
}

interface QueuedShoppingInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	name: string;
	quantity: string | null;
	now?: number;
}

interface QueuedShoppingUpdateInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	itemId: string;
	name: string;
	bought: boolean;
	expectedUpdatedAt: string;
	expectedBoughtAt: string | null;
	now?: number;
}

interface QueuedAnnouncementInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	content: string;
	kind: string;
	imageUrl?: string | null;
	now?: number;
}

interface QueuedChoreCompletionInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	choreId: string;
	expectedNextDueAt: string;
	expectedAssignedMemberId: string | null;
	now?: number;
}

interface QueuedChoreInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	title: string;
	recurrenceType?: 'days' | 'months';
	intervalDays: number;
	assignedMemberId: string | null;
	now?: number;
}

interface QueuedAbsenceInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	absenceMemberId: string;
	startDate: string;
	endDate: string;
	reason: string | null;
	now?: number;
}

interface QueuedExpenseInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	description: string;
	amountCents: number;
	paidByMemberId: string;
	splits: Array<{ debtorMemberId: string; amountCents: number }>;
	imageUrl?: string | null;
	recurringExpenseId?: string;
	expectedRecurringNextDueAt?: string;
	now?: number;
}

interface QueuedExpenseUpdateInput extends QueuedExpenseInput {
	expenseId: string;
	expectedUpdatedAt: string;
}

interface QueuedRecurringInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	description: string;
	amountCents: number;
	paidByMemberId: string;
	intervalMonths: number;
	nextDueAt: string;
	/** Unclamped start day; must replay unchanged with the same idempotency key. */
	anchorAt?: string;
	splits: Array<{ debtorMemberId: string; amountCents: number }>;
	now?: number;
}

const OFFLINE_IDEMPOTENCY_KEY_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOfflineIdempotencyKey(value: unknown): value is string {
	return typeof value === 'string' && OFFLINE_IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function createOfflineIdempotencyKey(): string | null {
	try {
		const key = crypto.randomUUID();
		return isOfflineIdempotencyKey(key) ? key : null;
	} catch {
		return null;
	}
}

function slug(value: string): string {
	return (
		value
			.trim()
			.toLocaleLowerCase('de-DE')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'item'
	);
}

function pathSegment(value: unknown): string {
	return encodeURIComponent(String(value));
}

function createQueuedAction(
	id: string,
	type: OfflineAction['type'],
	wgId: string | undefined,
	shareCode: string,
	memberId: string,
	payload: OfflineAction['payload'],
	now: number,
	idempotencyKeyOverride?: string,
): OfflineAction {
	const idempotencyKey = isOfflineIdempotencyKey(idempotencyKeyOverride)
		? idempotencyKeyOverride
		: createOfflineIdempotencyKey();
	return {
		id,
		...(idempotencyKey ? { idempotencyKey } : {}),
		type,
		...(wgId ? { wgId } : {}),
		shareCode,
		memberId,
		createdAt: new Date(now).toISOString(),
		payload,
	};
}

export function createQueuedShoppingItem(input: QueuedShoppingInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`shopping:${input.shareCode}:${now}:${slug(input.name)}`,
		'shopping.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{ name: input.name, quantity: input.quantity },
		now,
		input.idempotencyKey,
	);
}

export function createQueuedShoppingUpdate(input: QueuedShoppingUpdateInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`shopping-update:${input.shareCode}:${now}:${input.itemId}`,
		'shopping.update',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			itemId: input.itemId,
			name: input.name,
			bought: input.bought,
			expectedUpdatedAt: input.expectedUpdatedAt,
			expectedBoughtAt: input.expectedBoughtAt,
		},
		now,
		input.idempotencyKey,
	);
}

export function createQueuedAnnouncement(input: QueuedAnnouncementInput): OfflineAction {
	const now = input.now ?? Date.now();
	const action = createQueuedAction(
		`announcement:${input.shareCode}:${now}:${slug(input.content)}`,
		'announcement.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{ content: input.content, kind: input.kind, imageUrl: input.imageUrl ?? null },
		now,
	);
	return input.idempotencyKey && isOfflineIdempotencyKey(input.idempotencyKey)
		? { ...action, idempotencyKey: input.idempotencyKey }
		: action;
}

export function createQueuedChoreCompletion(input: QueuedChoreCompletionInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`chore:${input.shareCode}:${now}:${input.choreId}`,
		'chore.complete',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			choreId: input.choreId,
			expectedNextDueAt: input.expectedNextDueAt,
			expectedAssignedMemberId: input.expectedAssignedMemberId,
		},
		now,
		input.idempotencyKey,
	);
}

export function createQueuedChore(input: QueuedChoreInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`chore-create:${input.shareCode}:${now}:${slug(input.title)}`,
		'chore.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			title: input.title,
			intervalDays: input.intervalDays,
			recurrenceType: input.recurrenceType ?? 'days',
			assignedMemberId: input.assignedMemberId,
		},
		now,
		input.idempotencyKey,
	);
}

export function createQueuedAbsence(input: QueuedAbsenceInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`absence:${input.shareCode}:${now}:${input.absenceMemberId}`,
		'absence.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			memberId: input.absenceMemberId,
			startDate: input.startDate,
			endDate: input.endDate,
			reason: input.reason,
		},
		now,
		input.idempotencyKey,
	);
}

export function createQueuedExpense(input: QueuedExpenseInput): OfflineAction {
	const now = input.now ?? Date.now();
	const action = createQueuedAction(
		`expense:${input.shareCode}:${now}:${slug(input.description)}`,
		'expense.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			description: input.description,
			amountCents: input.amountCents,
			paidByMemberId: input.paidByMemberId,
			splits: input.splits,
			imageUrl: input.imageUrl ?? null,
			...(input.recurringExpenseId ? { recurringExpenseId: input.recurringExpenseId } : {}),
			...(input.expectedRecurringNextDueAt
				? { expectedRecurringNextDueAt: input.expectedRecurringNextDueAt }
				: {}),
		},
		now,
	);
	return input.idempotencyKey && isOfflineIdempotencyKey(input.idempotencyKey)
		? { ...action, idempotencyKey: input.idempotencyKey }
		: action;
}

export function createQueuedExpenseUpdate(input: QueuedExpenseUpdateInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`expense-update:${input.shareCode}:${now}:${input.expenseId}`,
		'expense.update',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			expenseId: input.expenseId,
			expectedUpdatedAt: input.expectedUpdatedAt,
			description: input.description,
			amountCents: input.amountCents,
			paidByMemberId: input.paidByMemberId,
			splits: input.splits,
			imageUrl: input.imageUrl,
		},
		now,
	);
}

export function createQueuedRecurring(input: QueuedRecurringInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`recurring:${input.shareCode}:${now}:${slug(input.description)}`,
		'recurring.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			description: input.description,
			amountCents: input.amountCents,
			paidByMemberId: input.paidByMemberId,
			intervalMonths: input.intervalMonths,
			nextDueAt: input.nextDueAt,
			...(input.anchorAt ? { anchorAt: input.anchorAt } : {}),
			splits: input.splits,
		},
		now,
		input.idempotencyKey,
	);
}

export function serializeOfflineAction(action: OfflineAction): string {
	return JSON.stringify(action);
}

export function getOfflineActionRequest(action: OfflineAction): OfflineActionRequest {
	return offlineActionHandlers[action.type].buildRequest(action);
}

export function hasQueuedShoppingUpdate(
	actions: readonly OfflineAction[],
	shareCode: string,
	memberId: string,
	itemId: string,
): boolean {
	return actions.some(
		(action) =>
			action.type === 'shopping.update' &&
			action.shareCode === shareCode &&
			action.memberId === memberId &&
			action.payload.itemId === itemId,
	);
}

const QUEUED_CREATE_ID_RE = /^(?:shopping|chore-create|absence):[^:]+:\d+:/;

/**
 * True for the synthetic id of a create made offline (e.g.
 * `shopping:<code>:<ms>:<slug>`). The server never issues such ids, so a row
 * carrying one is local-only even after its queue entry was discarded.
 */
export function isQueuedCreateId(id: string): boolean {
	return QUEUED_CREATE_ID_RE.test(id);
}

/**
 * Returns the queue without the queued create `id` of this WG and without
 * follow-up actions that target it, or `null` when no such entry is queued.
 */
export function withoutQueuedEntry(
	actions: readonly OfflineAction[],
	shareCode: string,
	id: string,
): OfflineAction[] | null {
	const sameWg = (action: OfflineAction) => action.shareCode === shareCode;
	if (!actions.some((action) => sameWg(action) && action.id === id)) return null;
	return actions.filter(
		(action) =>
			!(
				sameWg(action) &&
				(action.id === id || action.payload.itemId === id || action.payload.choreId === id)
			),
	);
}

export function getOfflineActionSummary(action: OfflineAction): OfflineActionSummary {
	return offlineActionHandlers[action.type].summary(action);
}

const STALE_ACTION_RISK: OfflineActionRisk = {
	title: 'Vor dem Senden prüfen',
	detail: 'Der Eintrag ist schon länger in der Warteschlange und könnte nicht mehr aktuell sein.',
};

const offlineActionHandlers: Record<OfflineActionType, OfflineActionHandler> = {
	'shopping.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/shopping`,
			method: 'POST',
			body: { ...action.payload, addedByMemberId: action.memberId },
		}),
		summary: (action) => ({
			title: 'Einkauf',
			detail: String(action.payload.name ?? 'Neuer Artikel'),
		}),
		// No type-specific risk hint for this action; falls back to the generic staleness warning.
		risk: () => STALE_ACTION_RISK,
	},

	'shopping.update': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/shopping/${pathSegment(action.payload.itemId)}`,
			method: 'PATCH',
			body: {
				bought: action.payload.bought,
				expectedUpdatedAt: action.payload.expectedUpdatedAt,
				expectedBoughtAt: action.payload.expectedBoughtAt,
			},
		}),
		summary: (action) => ({
			title: 'Einkauf',
			detail: `${String(action.payload.name ?? 'Artikel')} ${
				action.payload.bought === true ? 'abhaken' : 'wieder öffnen'
			}`,
		}),
		risk: () => ({
			title: 'Status prüfen',
			detail: 'Prüfe kurz, ob der Einkauf inzwischen von jemand anderem geändert wurde.',
		}),
	},

	'announcement.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/announcements`,
			method: 'POST',
			body: Object.fromEntries(
				Object.entries(action.payload).filter(([, value]) => value !== null),
			),
		}),
		summary: (action) => ({
			title: 'Pinnwand-Beitrag',
			detail: String(action.payload.content ?? 'Neuer Beitrag'),
		}),
		risk: () => ({
			title: 'Pinnwand prüfen',
			detail: 'Prüfe kurz, ob Inhalt, Kategorie oder Status inzwischen überholt sind.',
		}),
	},

	'absence.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/absences`,
			method: 'POST',
			body: Object.fromEntries(
				Object.entries(action.payload).filter(([, value]) => value !== null),
			),
		}),
		summary: () => ({
			title: 'Abwesenheit',
			detail: 'Rotation überspringt diese Person',
		}),
		risk: () => ({
			title: 'Abwesenheit prüfen',
			detail: 'Prüfe kurz, ob Zeitraum oder Putzplan inzwischen geändert wurden.',
		}),
	},

	'chore.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/chores`,
			method: 'POST',
			body: action.payload,
		}),
		summary: (action) => ({
			title: 'Putzplan-Aufgabe',
			detail: String(action.payload.title ?? 'Neue Aufgabe'),
		}),
		risk: () => ({
			title: 'Putzplan prüfen',
			detail: 'Prüfe kurz, ob Aufgabe, Intervall oder Zuweisung inzwischen geändert wurden.',
		}),
	},

	'chore.complete': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/chores/${pathSegment(action.payload.choreId)}/complete`,
			method: 'POST',
			body: {
				expectedNextDueAt: action.payload.expectedNextDueAt,
				expectedAssignedMemberId: action.payload.expectedAssignedMemberId,
			},
		}),
		summary: () => ({
			title: 'Putzplan',
			detail: 'Aufgabe als erledigt markieren',
		}),
		risk: () => ({
			title: 'Möglicher Konflikt',
			detail: 'Prüfe kurz, ob die Aufgabe inzwischen schon erledigt oder neu zugewiesen wurde.',
		}),
	},

	'expense.create': {
		buildRequest: (action) => {
			return {
				path: `/api/wg/${pathSegment(action.shareCode)}/expenses`,
				method: 'POST',
				body: Object.fromEntries(
					Object.entries(action.payload).filter(([, value]) => value !== null),
				),
			};
		},

		summary: (action) => ({
			title: 'Ausgabe',
			detail: String(action.payload.description ?? 'Neue Ausgabe'),
		}),
		risk: () => ({
			title: 'Aufteilung prüfen',
			detail:
				'Wenn sich Mitglieder oder Beträge geändert haben, bearbeite die Ausgabe vor dem Senden.',
		}),
	},

	'expense.update': {
		buildRequest: (action) => {
			const { expenseId, ...expensePayload } = action.payload;
			return {
				path: `/api/wg/${pathSegment(action.shareCode)}/expenses/${pathSegment(expenseId)}`,
				method: 'PATCH',
				body: expensePayload,
			};
		},
		summary: (action) => ({
			title: 'Ausgabe aktualisieren',
			detail: String(action.payload.description ?? 'Ausgabe'),
		}),
		risk: () => ({
			title: 'Version prüfen',
			detail: 'Die Ausgabe wird nur aktualisiert, wenn sie seit dem Bearbeiten unverändert blieb.',
		}),
	},

	'recurring.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/recurring-expenses`,
			method: 'POST',
			body: action.payload,
		}),
		summary: (action) => ({
			title: 'Fixkosten-Vorlage',
			detail: String(action.payload.description ?? 'Neue Vorlage'),
		}),
		risk: () => ({
			title: 'Fixkosten prüfen',
			detail: 'Prüfe Fälligkeit und Aufteilung, bevor die Vorlage gesendet wird.',
		}),
	},

	'recurring.advance': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/recurring-expenses`,
			method: 'PATCH',
			body: {
				id: action.payload.recurringExpenseId,
				...(typeof action.payload.expectedRecurringNextDueAt === 'string'
					? { expectedNextDueAt: action.payload.expectedRecurringNextDueAt }
					: {}),
			},
		}),
		summary: () => ({
			title: 'Fixkosten-Vorlage',
			detail: 'Fälligkeit nachholen',
		}),
		risk: () => ({
			title: 'Fixkosten prüfen',
			detail: 'Prüfe kurz, ob die Vorlage inzwischen schon weitergeschoben wurde.',
		}),
	},
};

function getOfflineRetryDelayMs(action: OfflineAction): number {
	const attempts = action.attempts ?? 0;
	if (attempts <= 0) return 0;
	return Math.min(15 * 60_000, 15_000 * 2 ** attempts);
}

export function shouldRetryOfflineAction(action: OfflineAction, now = Date.now()): boolean {
	if (!action.lastAttemptAt) return true;
	const lastAttempt = parseTimestamp(action.lastAttemptAt);
	if (lastAttempt === null) return true;
	// A lastAttempt far in the future means the device clock has been
	// corrected backwards — treat it as "now" instead of blocking retries
	// until the clock catches up.
	const effectiveLastAttempt = Math.min(lastAttempt, now);
	return now - effectiveLastAttempt >= getOfflineRetryDelayMs(action);
}

export function getOfflineActionRisk(
	action: OfflineAction,
	now = Date.now(),
): OfflineActionRisk | null {
	const createdAt = parseTimestamp(action.createdAt);
	if (createdAt === null) {
		return {
			title: 'Zeitpunkt prüfen',
			detail: 'Der gespeicherte Zeitpunkt ist unklar. Prüfe den Eintrag vor dem erneuten Senden.',
		};
	}
	if (createdAt > now) {
		return {
			title: 'Zeitpunkt prüfen',
			detail: 'Der gespeicherte Zeitpunkt liegt in der Zukunft. Prüfe den Eintrag vor dem Senden.',
		};
	}
	const ageHours = Math.floor((now - createdAt) / 3_600_000);
	if (ageHours < 6 && !action.lastError) return null;
	// A fresh no-connection failure says nothing about the server state.
	if (ageHours < 6 && action.lastError?.startsWith(OFFLINE_NO_CONNECTION_TITLE)) return null;
	return offlineActionHandlers[action.type].risk(action);
}
