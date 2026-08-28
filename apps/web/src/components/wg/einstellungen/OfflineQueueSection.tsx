'use client';

import { Section } from '@/components/wg/einstellungen/Section';
import { apiFetch } from '@/core/infra/api-client';
import {
	type QueueEditDraft,
	buildDraftKey,
	buildQueueEditDraft,
	buildQueueEditHref,
	readDraft,
	writeDraft,
} from '@/lib/wg/drafts';
import { readOfflineQueue, syncOfflineActions, writeOfflineQueue } from '@/lib/wg/offline-client';
import {
	formatRecurringAdvanceConflictNote,
	formatRecurringTemplateConflictNote,
} from '@/lib/wg/offline-conflicts';
import { formatOfflineQueueCount } from '@/lib/wg/offline-copy';
import {
	type OfflineAction,
	explainOfflineActionFailure,
	getOfflineActionRisk,
	getOfflineActionSummary,
} from '@/lib/wg/offline-queue';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export function OfflineQueueSection({
	shareCode,
	memberId,
}: {
	shareCode: string;
	memberId: string;
}) {
	const [items, setItems] = useState<OfflineAction[]>([]);
	const [syncing, setSyncing] = useState(false);
	const [conflictNotes, setConflictNotes] = useState<Record<string, string>>({});
	const [checkingServerIds, setCheckingServerIds] = useState<Set<string>>(new Set());
	const syncingRef = useRef(false);
	const checkingServerIdsRef = useRef<Set<string>>(new Set());
	const encodedShareCode = encodeURIComponent(shareCode);
	const isActiveMemberItem = useCallback(
		(item: OfflineAction): boolean => item.shareCode === shareCode && item.memberId === memberId,
		[memberId, shareCode],
	);

	const refresh = useCallback((): void => {
		setItems(readOfflineQueue().filter(isActiveMemberItem));
	}, [isActiveMemberItem]);

	useEffect(() => {
		refresh();
		window.addEventListener('manawg:offline-queue', refresh);
		return () => window.removeEventListener('manawg:offline-queue', refresh);
	}, [refresh]);

	function remove(id: string): void {
		const saved = writeOfflineQueue(
			readOfflineQueue().filter((item) => item.id !== id || !isActiveMemberItem(item)),
		);
		if (!saved) {
			setConflictNotes((current) => ({
				...current,
				[id]: 'Offline-Speicher ist blockiert. Die Aktion konnte nicht verworfen werden.',
			}));
			return;
		}
		refresh();
	}

	function removeAttachment(id: string): void {
		const saved = writeOfflineQueue(
			readOfflineQueue().map((item) =>
				item.id === id && isActiveMemberItem(item)
					? { ...item, payload: { ...item.payload, imageUrl: null } }
					: item,
			),
		);
		if (!saved) {
			setConflictNotes((current) => ({
				...current,
				[id]: 'Offline-Speicher ist blockiert. Der Anhang konnte nicht entfernt werden.',
			}));
			return;
		}
		setConflictNotes((current) => ({
			...current,
			[id]: 'Anhang entfernt. Die Offline-Aktion kann wieder synchronisiert werden.',
		}));
		refresh();
	}

	function editHref(item: OfflineAction): string {
		if (item.type === 'shopping.create') return buildQueueEditHref(shareCode, 'shopping');
		if (item.type === 'announcement.create') return buildQueueEditHref(shareCode, 'announcement');
		if (item.type === 'expense.create') return buildQueueEditHref(shareCode, 'expense');
		if (item.type === 'recurring.create') return buildQueueEditHref(shareCode, 'expense');
		if (item.type === 'absence.create') {
			return buildQueueEditHref(shareCode, 'chore', { openAbsencesPanel: true });
		}
		return buildQueueEditHref(shareCode, 'chore');
	}

	function edit(item: OfflineAction, draft: QueueEditDraft): void {
		const key = buildDraftKey(shareCode, draft.module);
		// Never clobber an unsaved form draft with queue-edit data — it would
		// be lost without any hint. Ask the user to resolve the form first.
		const existing = readDraft<Record<string, unknown>>(key);
		if (existing && JSON.stringify(existing) !== JSON.stringify(draft.draft)) {
			setConflictNotes((current) => ({
				...current,
				[item.id]:
					'Es existiert bereits ein anderer ungespeicherter Formular-Entwurf für dieses Modul. Öffne das Formular, speichere oder verwerfe ihn, und bearbeite dann den Queue-Eintrag.',
			}));
			return;
		}
		const saved = writeDraft(key, draft.draft);
		if (!saved) {
			setConflictNotes((current) => ({
				...current,
				[item.id]:
					'Offline-Speicher ist blockiert. Der Entwurf konnte nicht zum Bearbeiten geöffnet werden.',
			}));
			return;
		}
		window.location.assign(editHref(item));
	}

	function setConflictNote(id: string, note: string): void {
		setConflictNotes((current) => ({ ...current, [id]: note }));
	}

	function setServerCheckError(id: string, status: number, error: string): void {
		if (
			error === 'not_a_member' ||
			error === 'member_id_required' ||
			error === 'member_id_invalid' ||
			error === 'wg_not_found' ||
			error === 'invalid_share_code'
		) {
			const failure = explainOfflineActionFailure(status, error);
			setConflictNote(id, `${failure.title}: ${failure.detail}`);
			return;
		}
		setConflictNote(
			id,
			'Server-Vergleich konnte nicht geladen werden. Versuche es erneut, bevor du diese Aktion sendest.',
		);
	}

	async function checkServer(item: OfflineAction): Promise<void> {
		if (checkingServerIdsRef.current.has(item.id)) return;
		checkingServerIdsRef.current = new Set(checkingServerIdsRef.current).add(item.id);
		setCheckingServerIds(new Set(checkingServerIdsRef.current));
		try {
			await checkServerInner(item);
		} finally {
			const next = new Set(checkingServerIdsRef.current);
			next.delete(item.id);
			checkingServerIdsRef.current = next;
			setCheckingServerIds(next);
		}
	}

	async function checkServerInner(item: OfflineAction): Promise<void> {
		if (item.type === 'shopping.create') {
			const name = String(item.payload.name ?? '').trim();
			const res = await apiFetch<{
				items: Array<{ name: string; quantity: string | null; boughtAt: string | null }>;
			}>(`/api/wg/${encodedShareCode}/shopping`, { memberId });
			if (!res.ok) {
				setServerCheckError(item.id, res.status, res.error);
				return;
			}
			const serverItem = res.data.items.find((shoppingItem) => shoppingItem.name.trim() === name);
			setConflictNote(
				item.id,
				serverItem
					? `Ähnlicher Einkaufsartikel existiert schon. Status dort: ${
							serverItem.boughtAt ? 'erledigt' : 'offen'
						}. Prüfe vor dem Senden, ob es ein Duplikat wäre.`
					: 'Kein gleichnamiger Einkaufsartikel auf dem Server gefunden.',
			);
			return;
		}
		if (item.type === 'shopping.update') {
			const itemId = String(item.payload.itemId ?? '');
			const res = await apiFetch<{
				items: Array<{ id: string; boughtAt: string | null }>;
			}>(`/api/wg/${encodedShareCode}/shopping`, { memberId });
			if (!res.ok) {
				setServerCheckError(item.id, res.status, res.error);
				return;
			}
			const serverItem = res.data.items.find((shoppingItem) => shoppingItem.id === itemId);
			setConflictNote(
				item.id,
				serverItem
					? `Server-Version gefunden. Status dort: ${
							serverItem.boughtAt ? 'erledigt' : 'offen'
						}. Prüfe vor dem erneuten Senden, ob das noch stimmt.`
					: 'Der Einkaufsartikel existiert serverseitig nicht mehr.',
			);
			return;
		}
		if (item.type === 'announcement.create') {
			const content = String(item.payload.content ?? '').trim();
			const res = await apiFetch<{
				announcements: Array<{ content: string; resolvedAt?: string | null }>;
			}>(`/api/wg/${encodedShareCode}/announcements`, { memberId });
			if (!res.ok) {
				setServerCheckError(item.id, res.status, res.error);
				return;
			}
			const serverPost = res.data.announcements.find(
				(announcement) => announcement.content.trim() === content,
			);
			setConflictNote(
				item.id,
				serverPost
					? `Gleicher Pinnwand-Beitrag existiert schon. Status dort: ${
							serverPost.resolvedAt ? 'geklärt' : 'offen'
						}. Prüfe vor dem Senden, ob es ein Duplikat wäre.`
					: 'Kein gleicher Pinnwand-Beitrag auf dem Server gefunden.',
			);
			return;
		}
		if (item.type === 'chore.complete') {
			const choreId = String(item.payload.choreId ?? '');
			const res = await apiFetch<{
				chores: Array<{ id: string; assignedMemberId: string | null }>;
			}>(`/api/wg/${encodedShareCode}/chores`, { memberId });
			if (!res.ok) {
				setServerCheckError(item.id, res.status, res.error);
				return;
			}
			const exists = res.data.chores.some((chore) => chore.id === choreId);
			setConflictNote(
				item.id,
				exists
					? 'Server-Version gefunden. Prüfe Zuständigkeit und Fälligkeit vor dem Senden.'
					: 'Die Aufgabe existiert serverseitig nicht mehr.',
			);
			return;
		}
		if (item.type === 'chore.create') {
			const title = String(item.payload.title ?? '').trim();
			const res = await apiFetch<{
				chores: Array<{ title: string; assignedMemberId: string | null; intervalDays: number }>;
			}>(`/api/wg/${encodedShareCode}/chores`, { memberId });
			if (!res.ok) {
				setServerCheckError(item.id, res.status, res.error);
				return;
			}
			const serverChore = res.data.chores.find((chore) => chore.title.trim() === title);
			setConflictNote(
				item.id,
				serverChore
					? `Gleiche Putzaufgabe existiert schon. Intervall dort: alle ${serverChore.intervalDays} Tage. Prüfe vor dem Senden, ob es ein Duplikat wäre.`
					: 'Keine gleichnamige Putzaufgabe auf dem Server gefunden.',
			);
			return;
		}
		if (item.type === 'absence.create') {
			const absenceMemberId = String(item.payload.memberId ?? '');
			const startDate = String(item.payload.startDate ?? '');
			const endDate = String(item.payload.endDate ?? '');
			const res = await apiFetch<{
				absences: Array<{ memberId: string; startDate: string; endDate: string }>;
			}>(`/api/wg/${encodedShareCode}/absences`, { memberId });
			if (!res.ok) {
				setServerCheckError(item.id, res.status, res.error);
				return;
			}
			const serverAbsence = res.data.absences.find(
				(absence) =>
					absence.memberId === absenceMemberId &&
					absence.startDate === startDate &&
					absence.endDate === endDate,
			);
			setConflictNote(
				item.id,
				serverAbsence
					? 'Gleiche Abwesenheit existiert schon auf dem Server.'
					: 'Keine gleiche Abwesenheit auf dem Server gefunden.',
			);
			return;
		}
		if (item.type === 'expense.create') {
			const description = String(item.payload.description ?? '').trim();
			const amountCents = Number(item.payload.amountCents ?? 0);
			const res = await apiFetch<{
				expenses: Array<{ description: string; amountCents: number }>;
			}>(`/api/wg/${encodedShareCode}/expenses`, { memberId });
			if (!res.ok) {
				setServerCheckError(item.id, res.status, res.error);
				return;
			}
			const serverExpense = res.data.expenses.find(
				(expense) =>
					expense.description.trim() === description && expense.amountCents === amountCents,
			);
			setConflictNote(
				item.id,
				serverExpense
					? 'Gleiche Ausgabe mit gleichem Betrag existiert schon. Prüfe vor dem Senden, ob es ein Duplikat wäre.'
					: 'Keine gleiche Ausgabe mit gleichem Betrag auf dem Server gefunden.',
			);
			return;
		}
		if (item.type === 'recurring.create') {
			const description = String(item.payload.description ?? '').trim();
			const amountCents = Number(item.payload.amountCents ?? 0);
			const res = await apiFetch<{
				recurringExpenses: Array<{ description: string; amountCents: number; nextDueAt: string }>;
			}>(`/api/wg/${encodedShareCode}/recurring-expenses`, { memberId });
			if (!res.ok) {
				setServerCheckError(item.id, res.status, res.error);
				return;
			}
			const serverTemplate = res.data.recurringExpenses.find(
				(template) =>
					template.description.trim() === description && template.amountCents === amountCents,
			);
			setConflictNote(
				item.id,
				serverTemplate
					? formatRecurringTemplateConflictNote(serverTemplate)
					: 'Keine gleiche Fixkosten-Vorlage auf dem Server gefunden.',
			);
			return;
		}
		if (item.type === 'recurring.advance') {
			const recurringExpenseId = String(item.payload.recurringExpenseId ?? '');
			const expectedNextDueAt = String(item.payload.expectedRecurringNextDueAt ?? '');
			const res = await apiFetch<{
				recurringExpenses: Array<{ id: string; nextDueAt: string }>;
			}>(`/api/wg/${encodedShareCode}/recurring-expenses`, { memberId });
			if (!res.ok) {
				setServerCheckError(item.id, res.status, res.error);
				return;
			}
			const serverTemplate = res.data.recurringExpenses.find(
				(template) => template.id === recurringExpenseId,
			);
			setConflictNote(
				item.id,
				serverTemplate
					? formatRecurringAdvanceConflictNote(serverTemplate, expectedNextDueAt)
					: 'Diese Fixkosten-Vorlage existiert serverseitig nicht mehr.',
			);
			return;
		}
		setConflictNote(
			item.id,
			'Server-Vergleich bereit: bearbeite den Entwurf, wenn sich Inhalt oder Aufteilung geändert haben.',
		);
	}

	async function retry(): Promise<void> {
		if (syncingRef.current || items.length === 0) return;
		syncingRef.current = true;
		setSyncing(true);
		try {
			await syncOfflineActions(shareCode, { force: true, memberId });
			refresh();
		} finally {
			syncingRef.current = false;
			setSyncing(false);
		}
	}

	return (
		<Section
			title="Offline-Warteschlange"
			hint="Aktionen, die ohne Netz vorgemerkt wurden und später synchronisiert werden."
		>
			<div className="space-y-3 p-3">
				<div className="flex items-center justify-between gap-3">
					<p className="text-[13px] text-[var(--text-2)]">
						{formatOfflineQueueCount(items.length)}
					</p>
					<button
						type="button"
						onClick={() => void retry()}
						disabled={syncing || items.length === 0}
						aria-label={
							syncing
								? 'Offline-Warteschlange wird synchronisiert'
								: 'Offline-Warteschlange erneut synchronisieren'
						}
						className="inline-flex h-11 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] disabled:opacity-50"
					>
						{syncing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
						Erneut versuchen
					</button>
				</div>
				{items.length > 0 && (
					<ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
						{items.map((item) => {
							const summary = getOfflineActionSummary(item);
							const fallback = explainOfflineActionFailure(0);
							const risk = getOfflineActionRisk(item);
							const editDraft = buildQueueEditDraft(item);
							const serverCheckLabel = `Server prüfen: ${summary.detail || summary.title}`;
							const actionLabel = summary.detail || summary.title;
							const rowBusy = syncing || checkingServerIds.has(item.id);
							return (
								<li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<p className="truncate text-[13px] font-medium text-[var(--text-1)]">
												{summary.title}
											</p>
											{item.attempts ? (
												<span className="shrink-0 rounded-full bg-[var(--danger)]/5 px-1.5 py-0.5 text-[11px] text-[var(--danger)]">
													{item.attempts}x
												</span>
											) : null}
										</div>
										<p className="truncate text-[12px] text-[var(--text-3)]">{summary.detail}</p>
										<p className="mt-0.5 line-clamp-2 text-[11.5px] text-[var(--text-3)]">
											{item.lastError ?? fallback.detail}
										</p>
										{risk && (
											<p className="mt-1 rounded-md bg-[var(--accent)]/10 px-2 py-1 text-[11.5px] text-[var(--accent)]">
												{risk.title}: {risk.detail}
											</p>
										)}
										{conflictNotes[item.id] && (
											<output
												aria-live="polite"
												className="mt-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11.5px] text-[var(--text-2)]"
											>
												{conflictNotes[item.id]}
											</output>
										)}
									</div>
									<div className="flex shrink-0 flex-col gap-1">
										<button
											type="button"
											aria-label={serverCheckLabel}
											onClick={() => void checkServer(item)}
											disabled={rowBusy}
											className="inline-flex h-11 items-center justify-center gap-1 rounded-md px-3 text-[12px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
										>
											{checkingServerIds.has(item.id) && (
												<Loader2 className="h-3 w-3 animate-spin" aria-hidden />
											)}
											{checkingServerIds.has(item.id) ? 'Prüft...' : 'Server prüfen'}
										</button>
										{editDraft ? (
											<button
												type="button"
												aria-label={`Offline-Aktion bearbeiten: ${actionLabel}`}
												onClick={() => edit(item, editDraft)}
												disabled={rowBusy}
												className="h-11 rounded-md px-3 text-[12px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
											>
												Bearbeiten
											</button>
										) : null}
										{item.payload.imageUrl ? (
											<button
												type="button"
												aria-label={`Anhang entfernen: ${actionLabel}`}
												onClick={() => removeAttachment(item.id)}
												disabled={rowBusy}
												className="h-11 rounded-md px-3 text-[12px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
											>
												Anhang weg
											</button>
										) : null}
										<button
											type="button"
											aria-label={`Offline-Aktion verwerfen: ${actionLabel}`}
											onClick={() => remove(item.id)}
											disabled={rowBusy}
											className="h-11 rounded-md px-3 text-[12px] text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
										>
											Verwerfen
										</button>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</Section>
	);
}
