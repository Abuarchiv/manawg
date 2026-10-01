'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { Section } from '@/components/wg/einstellungen/Section';
import { apiFetch } from '@/core/infra/api-client';
import {
	type QueueEditDraft,
	buildDraftKey,
	buildQueueEditDraft,
	buildQueueEditHref,
	isEmptyModuleDraft,
	readDraft,
	writeDraft,
} from '@/core/offline/drafts';
import {
	needsManualOfflineResolution,
	readOfflineQueue,
	syncOfflineActions,
	updateOfflineQueue,
} from '@/core/offline/offline-client';
import {
	formatRecurringAdvanceConflictNote,
	formatRecurringTemplateConflictNote,
} from '@/core/offline/offline-conflicts';
import { formatOfflineQueueCount } from '@/core/offline/offline-copy';
import {
	type OfflineAction,
	explainOfflineActionFailure,
	getOfflineActionRisk,
	getOfflineActionSummary,
} from '@/core/offline/offline-queue';
import { cn } from '@/shared/lib/cn';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ServerCheck {
	path: string;
	note: (payload: Record<string, unknown>, data: never) => string;
}

function serverCheck<Data>(
	path: string,
	note: (payload: Record<string, unknown>, data: Data) => string,
): ServerCheck {
	return { path, note: note as ServerCheck['note'] };
}

const SERVER_CHECKS: Record<string, ServerCheck> = {
	'shopping.create': serverCheck<{
		items: Array<{ name: string; quantity: string | null; boughtAt: string | null }>;
	}>('shopping', (payload, data) => {
		const name = String(payload.name ?? '').trim();
		const serverItem = data.items.find((shoppingItem) => shoppingItem.name.trim() === name);
		return serverItem
			? `Ähnlicher Einkaufsartikel existiert schon. Status dort: ${
					serverItem.boughtAt ? 'erledigt' : 'offen'
				}. Prüfe vor dem Senden, ob es ein Duplikat wäre.`
			: 'Kein gleichnamiger Einkaufsartikel auf dem Server gefunden.';
	}),
	'shopping.update': serverCheck<{ items: Array<{ id: string; boughtAt: string | null }> }>(
		'shopping',
		(payload, data) => {
			const itemId = String(payload.itemId ?? '');
			const serverItem = data.items.find((shoppingItem) => shoppingItem.id === itemId);
			return serverItem
				? `Server-Version gefunden. Status dort: ${
						serverItem.boughtAt ? 'erledigt' : 'offen'
					}. Prüfe vor dem erneuten Senden, ob das noch stimmt.`
				: 'Der Einkaufsartikel existiert serverseitig nicht mehr.';
		},
	),
	'announcement.create': serverCheck<{
		announcements: Array<{ content: string; resolvedAt?: string | null }>;
	}>('announcements', (payload, data) => {
		const content = String(payload.content ?? '').trim();
		const serverPost = data.announcements.find(
			(announcement) => announcement.content.trim() === content,
		);
		return serverPost
			? `Gleicher Pinnwand-Beitrag existiert schon. Status dort: ${
					serverPost.resolvedAt ? 'geklärt' : 'offen'
				}. Prüfe vor dem Senden, ob es ein Duplikat wäre.`
			: 'Kein gleicher Pinnwand-Beitrag auf dem Server gefunden.';
	}),
	'chore.complete': serverCheck<{ chores: Array<{ id: string }> }>('chores', (payload, data) => {
		const choreId = String(payload.choreId ?? '');
		return data.chores.some((chore) => chore.id === choreId)
			? 'Server-Version gefunden. Prüfe Zuständigkeit und Fälligkeit vor dem Senden.'
			: 'Die Aufgabe existiert serverseitig nicht mehr.';
	}),
	'chore.create': serverCheck<{ chores: Array<{ title: string; intervalDays: number }> }>(
		'chores',
		(payload, data) => {
			const title = String(payload.title ?? '').trim();
			const serverChore = data.chores.find((chore) => chore.title.trim() === title);
			return serverChore
				? `Gleiche Putzaufgabe existiert schon. Intervall dort: alle ${serverChore.intervalDays} Tage. Prüfe vor dem Senden, ob es ein Duplikat wäre.`
				: 'Keine gleichnamige Putzaufgabe auf dem Server gefunden.';
		},
	),
	'absence.create': serverCheck<{
		absences: Array<{ memberId: string; startDate: string; endDate: string }>;
	}>('absences', (payload, data) => {
		const absenceMemberId = String(payload.memberId ?? '');
		const startDate = String(payload.startDate ?? '');
		const endDate = String(payload.endDate ?? '');
		const serverAbsence = data.absences.find(
			(absence) =>
				absence.memberId === absenceMemberId &&
				absence.startDate === startDate &&
				absence.endDate === endDate,
		);
		return serverAbsence
			? 'Gleiche Abwesenheit existiert schon auf dem Server.'
			: 'Keine gleiche Abwesenheit auf dem Server gefunden.';
	}),
	'expense.create': serverCheck<{ expenses: Array<{ description: string; amountCents: number }> }>(
		'expenses',
		(payload, data) => {
			const description = String(payload.description ?? '').trim();
			const amountCents = Number(payload.amountCents ?? 0);
			const serverExpense = data.expenses.find(
				(expense) =>
					expense.description.trim() === description && expense.amountCents === amountCents,
			);
			return serverExpense
				? 'Gleiche Ausgabe mit gleichem Betrag existiert schon. Prüfe vor dem Senden, ob es ein Duplikat wäre.'
				: 'Keine gleiche Ausgabe mit gleichem Betrag auf dem Server gefunden.';
		},
	),
	'recurring.create': serverCheck<{
		recurringExpenses: Array<{ description: string; amountCents: number; nextDueAt: string }>;
	}>('recurring-expenses', (payload, data) => {
		const description = String(payload.description ?? '').trim();
		const amountCents = Number(payload.amountCents ?? 0);
		const serverTemplate = data.recurringExpenses.find(
			(template) =>
				template.description.trim() === description && template.amountCents === amountCents,
		);
		return serverTemplate
			? formatRecurringTemplateConflictNote(serverTemplate)
			: 'Keine gleiche Fixkosten-Vorlage auf dem Server gefunden.';
	}),
	'recurring.advance': serverCheck<{
		recurringExpenses: Array<{ id: string; nextDueAt: string }>;
	}>('recurring-expenses', (payload, data) => {
		const recurringExpenseId = String(payload.recurringExpenseId ?? '');
		const expectedNextDueAt = String(payload.expectedRecurringNextDueAt ?? '');
		const serverTemplate = data.recurringExpenses.find(
			(template) => template.id === recurringExpenseId,
		);
		return serverTemplate
			? formatRecurringAdvanceConflictNote(serverTemplate, expectedNextDueAt)
			: 'Diese Fixkosten-Vorlage existiert serverseitig nicht mehr.';
	}),
};

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
	const hasRetryableItems = items.some((item) => !needsManualOfflineResolution(item));

	const refresh = useCallback((): void => {
		setItems(readOfflineQueue().filter(isActiveMemberItem));
	}, [isActiveMemberItem]);

	useEffect(() => {
		refresh();
		window.addEventListener('manawg:offline-queue', refresh);
		return () => window.removeEventListener('manawg:offline-queue', refresh);
	}, [refresh]);

	async function remove(id: string): Promise<void> {
		const saved = await updateOfflineQueue((actions) =>
			actions.filter((item) => item.id !== id || !isActiveMemberItem(item)),
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

	async function removeAttachment(id: string): Promise<void> {
		const saved = await updateOfflineQueue((actions) =>
			actions.map((item) =>
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

	// The page that reads the draft is derived from the draft's own module, so
	// the draft key and the opened form can never disagree.
	function editHref(item: OfflineAction, draft: QueueEditDraft): string {
		return buildQueueEditHref(shareCode, draft.module, {
			openAbsencesPanel: item.type === 'absence.create',
		});
	}

	function inspectHref(item: OfflineAction): string {
		const module = item.type.startsWith('shopping.')
			? 'einkauf'
			: item.type === 'announcement.create'
				? 'pinnwand'
				: item.type.startsWith('expense.') || item.type.startsWith('recurring.')
					? 'ausgaben'
					: 'putzen';
		return `/wg/${encodeURIComponent(shareCode)}/${module}`;
	}

	function edit(item: OfflineAction, draft: QueueEditDraft): void {
		const key = buildDraftKey(shareCode, memberId, draft.module);
		// Never clobber an unsaved form draft with queue-edit data — it would
		// be lost without any hint. Ask the user to resolve the form first.
		const existing = readDraft<Record<string, unknown>>(key);
		if (
			existing &&
			!isEmptyModuleDraft(draft.module, existing, memberId) &&
			JSON.stringify(existing) !== JSON.stringify(draft.draft)
		) {
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
		window.location.assign(editHref(item, draft));
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
		const check = SERVER_CHECKS[item.type];
		if (!check) {
			setConflictNote(
				item.id,
				'Server-Vergleich bereit: bearbeite den Entwurf, wenn sich Inhalt oder Aufteilung geändert haben.',
			);
			return;
		}
		const res = await apiFetch<unknown>(`/api/wg/${encodedShareCode}/${check.path}`, { memberId });
		if (!res.ok) {
			setServerCheckError(item.id, res.status, res.error);
			return;
		}
		setConflictNote(item.id, check.note(item.payload, res.data as never));
	}

	async function retry(): Promise<void> {
		if (syncingRef.current || !hasRetryableItems) return;
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
			<div className="grid gap-3 p-3">
				<div className="flex min-h-[44px] flex-wrap items-center justify-between gap-3">
					<p className="text-muted-foreground text-[12px]">
						{formatOfflineQueueCount(items.length)}
					</p>
					{hasRetryableItems && (
						<Button
							type="button"
							variant="outline"
							onClick={() => void retry()}
							disabled={syncing}
							aria-label={
								syncing
									? 'Offline-Warteschlange wird synchronisiert'
									: 'Offline-Warteschlange erneut synchronisieren'
							}
						>
							{syncing && <Spinner aria-hidden />}
							Erneut versuchen
						</Button>
					)}
				</div>
				{items.length > 0 && (
					<ItemGroup className="gap-2">
						{items.map((item) => {
							const summary = getOfflineActionSummary(item);
							const fallback = explainOfflineActionFailure(0);
							const risk = getOfflineActionRisk(item);
							const editDraft = buildQueueEditDraft(item);
							const requiresManualReview = item.lastError?.startsWith('Server prüfen:') === true;
							const requiresManualResolution = needsManualOfflineResolution(item);
							const serverCheckLabel = `Server prüfen: ${summary.detail || summary.title}`;
							const actionLabel = summary.detail || summary.title;
							const rowBusy = syncing || checkingServerIds.has(item.id);
							return (
								<Item key={item.id} variant="outline" className="items-start">
									<ItemContent className="min-w-0">
										<ItemTitle>
											<span className="min-w-0 flex-1 truncate">{summary.title}</span>
											{item.attempts ? <Badge variant="destructive">{item.attempts}x</Badge> : null}
										</ItemTitle>
										<ItemDescription className="line-clamp-none">{summary.detail}</ItemDescription>
										{requiresManualResolution ? (
											<Alert className="mt-1" variant="destructive">
												<AlertDescription>{item.lastError}</AlertDescription>
											</Alert>
										) : (
											<p className="text-muted-foreground line-clamp-2 text-xs">
												{item.lastError ?? fallback.detail}
											</p>
										)}
										{risk && (
											<Alert className="mt-1">
												<AlertDescription>
													{risk.title}: {risk.detail}
												</AlertDescription>
											</Alert>
										)}
										{conflictNotes[item.id] && (
											<Alert className="mt-1">
												<AlertDescription>{conflictNotes[item.id]}</AlertDescription>
											</Alert>
										)}
										<div className="mt-2 flex flex-wrap gap-2">
											{requiresManualReview ? (
												<a
													href={inspectHref(item)}
													className={cn(
														buttonVariants({ variant: 'outline', size: 'sm' }),
														'min-h-11',
													)}
													aria-label={`WG-Eintrag prüfen: ${actionLabel}`}
												>
													WG-Eintrag prüfen
												</a>
											) : (
												<>
													<Button
														type="button"
														variant="outline"
														size="sm"
														aria-label={serverCheckLabel}
														onClick={() => void checkServer(item)}
														disabled={rowBusy}
													>
														{checkingServerIds.has(item.id) && <Spinner aria-hidden />}
														{checkingServerIds.has(item.id) ? 'Prüft…' : 'Server prüfen'}
													</Button>
													{editDraft ? (
														<Button
															type="button"
															variant="ghost"
															size="sm"
															aria-label={`Offline-Aktion bearbeiten: ${actionLabel}`}
															onClick={() => edit(item, editDraft)}
															disabled={rowBusy}
														>
															Bearbeiten
														</Button>
													) : null}
													{item.payload.imageUrl ? (
														<Button
															type="button"
															variant="ghost"
															size="sm"
															aria-label={`Anhang entfernen: ${actionLabel}`}
															onClick={() => removeAttachment(item.id)}
															disabled={rowBusy}
														>
															Anhang weg
														</Button>
													) : null}
												</>
											)}
											<Button
												type="button"
												variant="destructive"
												size="sm"
												aria-label={`Offline-Aktion verwerfen: ${actionLabel}`}
												onClick={() => remove(item.id)}
												disabled={rowBusy}
											>
												Verwerfen
											</Button>
										</div>
									</ItemContent>
								</Item>
							);
						})}
					</ItemGroup>
				)}
			</div>
		</Section>
	);
}
