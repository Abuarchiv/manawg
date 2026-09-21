'use client';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemGroup } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { AboCreateModal } from '@/components/wg/AboCreateModal';
import { AboEditModal } from '@/components/wg/AboEditModal';
import type { AboFormValues } from '@/components/wg/AboForm';
import { AbosList } from '@/components/wg/AbosList';
import {
	type ActionNotice,
	ActionNoticeBanner,
	type ActionNoticeTone,
} from '@/components/wg/ActionNoticeBanner';
import { BackLink } from '@/components/wg/BackLink';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import type { Abo, AboFilter } from '@/components/wg/abos-types';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { apiFetch } from '@/core/infra/api-client';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { cn } from '@/shared/lib/cn';
import { haptic } from '@/shared/lib/haptics';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
	if (error === 'recurring_currency_unsupported') {
		return `${prefix}: Fixkosten werden derzeit nur in Euro unterstützt.`;
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
	if (error === 'recurring_currency_unsupported') {
		return 'Abo-Aktion fehlgeschlagen: Fixkosten werden derzeit nur in Euro unterstützt.';
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
	const createRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);

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
	// Auto-Refresh wie auf dem Dashboard — ersetzt den manuellen Reload-Button.
	useVisibilityPausedInterval(() => void load(false), 30_000);

	function setNoticeMessage(tone: ActionNoticeTone, message: string): void {
		setNotice({ tone, message });
	}

	async function handleCreate(values: AboFormValues): Promise<void> {
		setSubmitting(true);
		const fingerprint = JSON.stringify(values);
		const pendingRequest = createRequestRef.current;
		const idempotencyKey =
			pendingRequest?.fingerprint === fingerprint
				? pendingRequest.key
				: createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setNoticeMessage('error', 'Abo konnte nicht sicher gespeichert werden. Versuche es erneut.');
			setSubmitting(false);
			return;
		}
		createRequestRef.current = { fingerprint, key: idempotencyKey };
		const res = await apiFetch<RecurringExpenseResponse>(
			`/api/wg/${encodedShareCode}/recurring-expenses`,
			{
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify(values),
			},
		);
		if (res.ok) {
			createRequestRef.current = null;
			haptic('medium');
			setAbos((current) => upsertAbo(current, res.data.recurringExpense));
			setShowCreate(false);
			setNoticeMessage('success', 'Abo angelegt.');
		} else {
			if (res.status > 0 && res.status < 500) createRequestRef.current = null;
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
				memberToken: identity.memberToken,
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
				memberToken: identity.memberToken,
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
			{ method: 'DELETE', memberId: identity.memberId, memberToken: identity.memberToken },
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
		<div data-finance-content className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
			<header className="flex min-w-0 flex-wrap items-center gap-3">
				<BackLink href={`/wg/${encodedShareCode}/ausgaben`} label="Ausgaben" />
				<div className="min-w-0 flex-1">
					<h1 className="font-heading text-2xl font-semibold tracking-tight break-words [overflow-wrap:anywhere]">
						Fixkosten
					</h1>
					<p className="text-sm text-muted-foreground" aria-live="polite">
						{loading ? '' : `${activeCount} aktiv · ${abos.length} insgesamt`}
					</p>
					<output
						aria-live="polite"
						aria-hidden={!refreshing}
						className={cn(
							'flex min-h-5 items-center gap-2 text-sm text-muted-foreground',
							!refreshing && 'invisible',
						)}
					>
						<Spinner />
						Wird aktualisiert…
					</output>
				</div>
				<Button
					className="w-9 shrink-0 px-0 sm:w-auto sm:px-3"
					onClick={() => setShowCreate(true)}
					aria-label="Neues Abo"
				>
					<Plus data-icon="inline-start" />
					<span className="hidden sm:inline">Neues Abo</span>
				</Button>
			</header>
			{loadError && (
				<LoadErrorBanner
					message={loadError}
					onRetry={() => void load(true)}
					busy={loading || refreshing}
					retryLabel="Abos erneut laden"
				/>
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
					loadError={loadError}
					onFilterChange={setFilter}
					onEdit={setEditing}
					onTogglePause={(abo) => void handleTogglePause(abo)}
					onDelete={setDeleteCandidate}
				/>
			)}
			{showCreate && (
				<AboCreateModal
					members={memberOptions}
					defaultPaidByMemberId={identity.memberId}
					submitting={submitting}
					saveError={notice?.tone === 'error' ? notice.message : null}
					onClose={() => setShowCreate(false)}
					onSubmit={(values) => void handleCreate(values)}
				/>
			)}
			{editing && (
				<AboEditModal
					abo={editing}
					members={memberOptions}
					submitting={submitting}
					saveError={notice?.tone === 'error' ? notice.message : null}
					onClose={() => setEditing(null)}
					onSubmit={(values) => void handleEdit(values)}
				/>
			)}
			<AlertDialog
				open={deleteCandidate !== null}
				onOpenChange={(open) => {
					if (!open) setDeleteCandidate(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Abo löschen?</AlertDialogTitle>
						<AlertDialogDescription>
							Abo „{deleteCandidate?.description}“ wird entfernt. Bereits erfasste Ausgaben bleiben
							erhalten.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">Abbrechen</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							className="min-h-11"
							disabled={pendingId !== null}
							onClick={() => {
								if (deleteCandidate) void handleDelete(deleteCandidate);
								setDeleteCandidate(null);
							}}
						>
							Löschen
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function AbosSkeleton() {
	return (
		<ItemGroup aria-busy="true" aria-label="Abos werden geladen">
			{['s1', 's2', 's3', 's4'].map((key) => (
				<Item key={key} variant="outline" aria-hidden="true">
					<ItemContent>
						<Skeleton className="h-4 w-2/3" />
						<Skeleton className="h-3 w-1/3" />
					</ItemContent>
					<Skeleton className="h-4 w-16" />
				</Item>
			))}
		</ItemGroup>
	);
}
