'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ALERT_DANGER } from '@/components/ui/styles';
import { AboCreateModal } from '@/components/wg/AboCreateModal';
import { AboEditModal } from '@/components/wg/AboEditModal';
import type { AboFormValues } from '@/components/wg/AboForm';
import { AbosList } from '@/components/wg/AbosList';
import {
	type ActionNotice,
	ActionNoticeBanner,
	type ActionNoticeTone,
} from '@/components/wg/ActionNoticeBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import type { Abo, AboFilter } from '@/components/wg/abos-types';
import { apiFetch } from '@/lib/api-client';
import { getWgLoadErrorMessage } from '@/lib/wg/load-errors';
import { haptic } from '@manawg/shared/lib/haptics';
import { Plus, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface RecurringExpensesResponse {
	recurringExpenses: Abo[];
}

interface RecurringExpenseResponse {
	recurringExpense: Abo;
}

function sortByNextDue(abos: Abo[]): Abo[] {
	return [...abos].sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt));
}

function upsertAbo(current: Abo[], next: Abo): Abo[] {
	const existing = current.some((abo) => abo.id === next.id);
	return sortByNextDue(
		existing ? current.map((abo) => (abo.id === next.id ? next : abo)) : [...current, next],
	);
}

const RETRYABLE_ERRORS = new Set(['unexpected_error', 'server_error', 'db_error']);
const MEMBERSHIP_ERRORS = new Set(['not_a_member', 'member_id_required', 'member_id_invalid']);

function aboSaveErrorMessage(error: string, action: 'angelegt' | 'aktualisiert'): string {
	const prefix = `Abo konnte nicht ${action} werden`;
	if (RETRYABLE_ERRORS.has(error)) {
		return `${prefix}: Versuche es gleich erneut.`;
	}
	if (error === 'wg_not_found') {
		return `${prefix}: Öffne die WG über den aktuellen Link erneut.`;
	}
	if (error === 'invalid_share_code') {
		return `${prefix}: Der WG-Code ist ungültig.`;
	}
	if (MEMBERSHIP_ERRORS.has(error)) {
		return `${prefix}: Tritt der WG erneut bei.`;
	}
	if (error === 'member_not_in_wg') {
		return `${prefix}: Mindestens ein Mitglied ist nicht mehr in dieser WG.`;
	}
	if (error === 'recurring_expense_not_found') {
		return 'Dieses Abo existiert nicht mehr. Lade die Abos neu.';
	}
	if (error === 'amount_invalid') {
		return `${prefix}: Prüfe den Betrag.`;
	}
	if (error === 'description_invalid') {
		return `${prefix}: Gib eine Beschreibung ein.`;
	}
	if (error === 'interval_invalid') {
		return `${prefix}: Wähle ein gültiges Intervall.`;
	}
	if (error === 'due_date_invalid') {
		return `${prefix}: Prüfe das nächste Fälligkeitsdatum.`;
	}
	if (error === 'splits_invalid' || error === 'splits_sum_mismatch') {
		return 'Beträge stimmen nicht überein: Summe muss exakt dem Gesamtbetrag entsprechen.';
	}
	if (error === 'invalid_body' || error === 'invalid_json') {
		return `${prefix}: Die Anfrage war ungültig.`;
	}
	return `${prefix}.`;
}

function aboActionErrorMessage(error: string): string {
	if (error === 'Netzwerkfehler' || error === 'Failed to fetch') {
		return 'Abo-Aktion fehlgeschlagen: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (RETRYABLE_ERRORS.has(error)) {
		return 'Abo-Aktion fehlgeschlagen: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Abo-Aktion fehlgeschlagen: Öffne die WG über den aktuellen Link erneut.';
	}
	if (error === 'invalid_share_code') {
		return 'Abo-Aktion fehlgeschlagen: Der WG-Code ist ungültig.';
	}
	if (MEMBERSHIP_ERRORS.has(error)) {
		return 'Abo-Aktion fehlgeschlagen: Tritt der WG erneut bei.';
	}
	if (error === 'recurring_expense_not_found') {
		return 'Dieses Abo existiert nicht mehr. Lade die Abos neu.';
	}
	if (error === 'invalid_body' || error === 'invalid_json') {
		return 'Abo-Aktion fehlgeschlagen: Die Anfrage war ungültig.';
	}
	return 'Abo-Aktion fehlgeschlagen.';
}

function aboDeleteErrorMessage(error: string): string {
	if (error === 'Netzwerkfehler' || error === 'Failed to fetch') {
		return 'Abo konnte nicht gelöscht werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (RETRYABLE_ERRORS.has(error)) {
		return 'Abo konnte nicht gelöscht werden: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Abo konnte nicht gelöscht werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (error === 'invalid_share_code') {
		return 'Abo konnte nicht gelöscht werden: Der WG-Code ist ungültig.';
	}
	if (MEMBERSHIP_ERRORS.has(error)) {
		return 'Abo konnte nicht gelöscht werden: Tritt der WG erneut bei.';
	}
	if (error === 'id_invalid') {
		return 'Abo konnte nicht gelöscht werden: Dieses Abo konnte nicht eindeutig zugeordnet werden.';
	}
	if (error === 'recurring_expense_not_found') {
		return 'Dieses Abo existiert nicht mehr. Lade die Abos neu.';
	}
	if (error === 'delete_failed') {
		return 'Abo konnte nicht gelöscht werden: Lade die Abos neu und prüfe, ob es noch existiert.';
	}
	if (error === 'invalid_body' || error === 'invalid_json') {
		return 'Abo konnte nicht gelöscht werden: Die Anfrage war ungültig.';
	}
	return 'Abo konnte nicht gelöscht werden.';
}

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function AbosPage() {
	const { wg, members, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const memberOptions = useMemo(
		() => members.map((member) => ({ ...member, color: member.color ?? null })),
		[members],
	);

	const [abos, setAbos] = useState<Abo[]>([]);
	const [filter, setFilter] = useState<AboFilter>('active');
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [notice, setNotice] = useState<ActionNotice | null>(null);
	const [showCreate, setShowCreate] = useState(false);
	const [editing, setEditing] = useState<Abo | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [deleteCandidate, setDeleteCandidate] = useState<Abo | null>(null);

	const load = useCallback(
		async (initial: boolean): Promise<void> => {
			if (initial) setLoading(true);
			else setRefreshing(true);
			const res = await apiFetch<RecurringExpensesResponse>(
				`/api/wg/${encodedShareCode}/recurring-expenses`,
				{ memberId: identity.memberId },
			);
			if (res.ok) {
				setAbos(sortByNextDue(res.data.recurringExpenses));
				setLoadError(null);
			} else {
				setLoadError(getWgLoadErrorMessage('Abos', res.status, res.error, { verb: 'konnten' }));
			}
			if (initial) setLoading(false);
			else setRefreshing(false);
		},
		[encodedShareCode, identity.memberId],
	);

	useEffect(() => {
		void load(true);
	}, [load]);

	function setNoticeMessage(tone: ActionNoticeTone, message: string): void {
		setNotice({ tone, message });
	}

	async function handleCreate(values: AboFormValues): Promise<void> {
		setSubmitting(true);
		const res = await apiFetch<RecurringExpenseResponse>(
			`/api/wg/${encodedShareCode}/recurring-expenses`,
			{
				method: 'POST',
				memberId: identity.memberId,
				body: JSON.stringify(values),
			},
		);
		if (res.ok) {
			haptic('medium');
			setAbos((current) => upsertAbo(current, res.data.recurringExpense));
			setShowCreate(false);
			setNoticeMessage('success', 'Abo angelegt.');
		} else {
			setNoticeMessage('error', aboSaveErrorMessage(res.error, 'angelegt'));
		}
		setSubmitting(false);
	}

	async function handleEdit(values: AboFormValues): Promise<void> {
		if (!editing) return;
		setSubmitting(true);
		const res = await apiFetch<RecurringExpenseResponse>(
			`/api/wg/${encodedShareCode}/recurring-expenses/${encodeURIComponent(editing.id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				body: JSON.stringify(values),
			},
		);
		if (res.ok) {
			haptic('medium');
			setAbos((current) => upsertAbo(current, res.data.recurringExpense));
			setEditing(null);
			setNoticeMessage('success', 'Abo aktualisiert.');
		} else {
			setNoticeMessage('error', aboSaveErrorMessage(res.error, 'aktualisiert'));
		}
		setSubmitting(false);
	}

	async function handleTogglePause(abo: Abo): Promise<void> {
		setPendingId(abo.id);
		const isPaused = abo.pausedAt !== null;
		const res = await apiFetch<RecurringExpenseResponse>(
			`/api/wg/${encodedShareCode}/recurring-expenses/${encodeURIComponent(abo.id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				body: JSON.stringify({ paused: !isPaused }),
			},
		);
		if (res.ok) {
			setAbos((current) => upsertAbo(current, res.data.recurringExpense));
			setNoticeMessage('success', isPaused ? 'Abo reaktiviert.' : 'Abo pausiert.');
		} else {
			setNoticeMessage('error', aboActionErrorMessage(res.error));
		}
		setPendingId(null);
	}

	async function handleDelete(abo: Abo): Promise<void> {
		setPendingId(abo.id);
		const res = await apiFetch<{ deleted: true }>(
			`/api/wg/${encodedShareCode}/recurring-expenses/${encodeURIComponent(abo.id)}`,
			{ method: 'DELETE', memberId: identity.memberId },
		);
		if (res.ok) {
			setAbos((current) => current.filter((item) => item.id !== abo.id));
			setNoticeMessage('success', 'Abo gelöscht.');
		} else {
			setNoticeMessage('error', aboDeleteErrorMessage(res.error));
		}
		setPendingId(null);
	}

	const activeCount = abos.filter((abo) => abo.pausedAt === null).length;

	return (
		<div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
			<header className="flex items-center justify-between gap-3">
				<div>
					<h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-1)]">Abos</h1>
					<p className="mt-0.5 text-[13px] text-[var(--text-3)]" aria-live="polite">
						{loading ? '' : `${activeCount} aktiv · ${abos.length} insgesamt`}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						onClick={() => void load(false)}
						disabled={loading || refreshing}
						aria-label={refreshing ? 'Abos werden aktualisiert' : 'Abos aktualisieren'}
						aria-busy={loading || refreshing}
						className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						<RotateCw
							className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`}
							aria-hidden
						/>
					</button>
					<button
						type="button"
						onClick={() => setShowCreate(true)}
						className="hidden sm:inline-flex h-11 items-center gap-1 rounded-md bg-[var(--text-1)] px-3 text-[12.5px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						<Plus className="h-4 w-4" aria-hidden /> Neues Abo
					</button>
				</div>
			</header>

			{loadError && (
				<div role="alert" className={ALERT_DANGER}>
					{loadError}
				</div>
			)}
			{notice && <ActionNoticeBanner notice={notice} />}

			{loading ? (
				<AbosSkeleton />
			) : (
				<AbosList
					abos={abos}
					members={memberOptions}
					filter={filter}
					pendingId={pendingId}
					onFilterChange={setFilter}
					onEdit={(abo) => setEditing(abo)}
					onTogglePause={(abo) => void handleTogglePause(abo)}
					onDelete={(abo) => setDeleteCandidate(abo)}
				/>
			)}

			{showCreate && (
				<AboCreateModal
					members={memberOptions}
					defaultPaidByMemberId={identity.memberId}
					submitting={submitting}
					onClose={() => setShowCreate(false)}
					onSubmit={(values) => void handleCreate(values)}
				/>
			)}

			{editing && (
				<AboEditModal
					abo={editing}
					members={memberOptions}
					submitting={submitting}
					onClose={() => setEditing(null)}
					onSubmit={(values) => void handleEdit(values)}
				/>
			)}

			<button
				type="button"
				onClick={() => {
					haptic('light');
					setShowCreate(true);
				}}
				aria-label="Neues Abo anlegen"
				className="fab-mobile sm:hidden inline-flex h-14 w-14 items-center justify-center rounded-full bg-[var(--text-1)] text-[var(--bg-base)] shadow-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
			>
				<Plus className="h-6 w-6" aria-hidden />
			</button>

			<ConfirmDialog
				open={deleteCandidate !== null}
				onClose={() => setDeleteCandidate(null)}
				onConfirm={() => {
					if (deleteCandidate) void handleDelete(deleteCandidate);
				}}
				title="Abo löschen?"
				description={
					deleteCandidate
						? `Abo „${deleteCandidate.description}" wird unwiderruflich entfernt.`
						: ''
				}
				confirmLabel="Löschen"
				cancelLabel="Abbrechen"
				variant="danger"
				icon={Trash2}
			/>
		</div>
	);
}

function AbosSkeleton() {
	return (
		<ul className="space-y-2" aria-busy="true" aria-label="Abos werden geladen">
			{['s1', 's2', 's3', 's4'].map((key) => (
				<li
					key={key}
					className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-base)] p-3"
				>
					<span className="h-10 w-10 shrink-0 animate-pulse rounded-md bg-[var(--surface-strong)]" />
					<div className="flex-1 space-y-1.5">
						<span className="block h-[14px] w-2/3 animate-pulse rounded bg-[var(--surface-strong)]" />
						<span className="block h-[12px] w-1/3 animate-pulse rounded bg-[var(--surface-strong)]" />
					</div>
					<span className="h-[14px] w-16 shrink-0 animate-pulse rounded bg-[var(--surface-strong)]" />
				</li>
			))}
		</ul>
	);
}
