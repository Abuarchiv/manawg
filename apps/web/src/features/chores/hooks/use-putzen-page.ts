import { useToast } from '@/components/ui/Toast';
import { useWg } from '@/components/wg/WgContextProvider';
import { usePendingSet } from '@/core/hooks/usePendingSet';
import { getAbsentMemberIds, pickVisibleAbsences } from '@/features/chores/absence';
import { buildChoreFairness, predictNextAssigneeId } from '@/features/chores/chore-fairness';
import {
	getChorePlanHealth,
	getChoreStatus,
	groupChoresForPlan,
} from '@/features/chores/chore-status';
import type { MemberInfo } from '@/features/chores/components/chore-types';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { ChorePageContext } from './chore-page-context';
import { useAbsenceFormState, useAbsences } from './use-absences';
import { useChoreActions } from './use-chore-actions';
import { useChoreCreate } from './use-chore-create';
import { useChoresData } from './use-chores-data';

export type { ChoreSuggestion } from './use-chore-create';

/** Putzplan-Seite: verbindet Laden, Anlegen, Aktionen und Abwesenheiten und leitet die Anzeige ab. */
export function usePutzenPage() {
	const { wg, members, identity } = useWg();
	const toast = useToast();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const searchParams = useSearchParams();
	const highlightedId = searchParams.get('highlight');
	const prefillTitle = searchParams.get('title');
	const overdueFilterActive = searchParams.get('filter') === 'overdue';
	const absencesPanelActive = searchParams.get('panel') === 'absences';
	const absenceId = searchParams.get('absence');
	const [actionError, setActionError] = useState<string | null>(null);
	const [actionNotice, setActionNotice] = useState<string | null>(null);
	const { isPending, start: startPending, end: endPending } = usePendingSet();

	const data = useChoresData({ wg, identity, encodedShareCode, setActionNotice });
	const { items, absences, initialLoading, loadError } = data;

	// A member who moved out ("Auszug") leaves the rotation and every picker.
	// `memberLookup` below still resolves their name from the full roster so the
	// history and past assignments keep displaying correctly.
	const activeMembers = members.filter((m) => m.active);

	const ctx: ChorePageContext = {
		wg,
		identity,
		members,
		activeMembers,
		encodedShareCode,
		toast,
		isPending,
		startPending,
		endPending,
		setActionError,
		setActionNotice,
		items,
		absences,
		setItems: data.setItems,
		updateChores: data.updateChores,
		updateAbsences: data.updateAbsences,
		load: data.load,
		refreshCount: data.refreshCount,
	};

	const absentMemberIds = getAbsentMemberIds(absences);
	const fairness = buildChoreFairness({
		members: activeMembers.map((member) => ({ id: member.id, name: member.name })),
		chores: items,
		absentMemberIds,
	});
	const absenceForm = useAbsenceFormState(identity.memberId);
	const create = useChoreCreate(ctx, absenceForm, prefillTitle, fairness.suggestedAssignee);
	const absenceActions = useAbsences(ctx, absenceForm, create.queueEdit);
	const choreActions = useChoreActions(ctx);

	const itemCount = items.length;
	useEffect(() => {
		if (!highlightedId || itemCount === 0) return;
		window.setTimeout(() => {
			document.getElementById(`chore-${highlightedId}`)?.scrollIntoView({
				block: 'center',
				behavior: 'smooth',
			});
		}, 80);
	}, [highlightedId, itemCount]);

	useEffect(() => {
		if (!overdueFilterActive) return;
		window.setTimeout(() => {
			document.getElementById('chore-list')?.scrollIntoView({
				block: 'start',
				behavior: 'smooth',
			});
		}, 80);
	}, [overdueFilterActive]);

	useEffect(() => {
		if (!absencesPanelActive && !absenceId) return;
		window.setTimeout(() => {
			document.getElementById('absences-panel')?.scrollIntoView({
				block: 'start',
				behavior: 'smooth',
			});
		}, 80);
	}, [absenceId, absencesPanelActive]);

	function memberLookup(id: string | null): MemberInfo {
		if (!id) return { name: 'Niemand', color: null };
		const m = members.find((x) => x.id === id);
		return { name: m?.name ?? '?', color: m?.color ?? null };
	}

	const showSkeleton = initialLoading && items.length === 0;
	const ownDueCount =
		!initialLoading && !loadError
			? items.filter(
					(chore) =>
						chore.assignedMemberId === identity.memberId &&
						['due', 'overdue'].includes(getChoreStatus(chore.nextDueAt).state),
				).length
			: undefined;
	const choreGroups = useMemo(
		() => groupChoresForPlan(items, identity.memberId),
		[identity.memberId, items],
	);
	const visibleAbsences = useMemo(
		() => pickVisibleAbsences(absences, absencesPanelActive, absenceId),
		[absenceId, absences, absencesPanelActive],
	);
	const nextAssigneeNameByChoreId = new Map<string, string | null>(
		items.map((chore): [string, string | null] => {
			const nextAssigneeId = predictNextAssigneeId(chore, items, activeMembers, absences);
			if (!nextAssigneeId) return [chore.id, null];
			return [
				chore.id,
				nextAssigneeId === identity.memberId ? 'du' : memberLookup(nextAssigneeId).name,
			];
		}),
	);

	return {
		activeMembers,
		absenceAddPending: isPending('absence:add'),
		absenceEnd: absenceForm.absenceEnd,
		absenceId,
		absenceMemberId: absenceForm.absenceMemberId,
		absenceReason: absenceForm.absenceReason,
		absenceStart: absenceForm.absenceStart,
		absences,
		absencesPanelActive,
		absentMemberIds,
		actionError,
		actionNotice,
		applyChoreSuggestion: create.applyChoreSuggestion,
		applyQuickChore: create.applyQuickChore,
		choreAddPending: isPending('chore:add'),
		choreGroups,
		completeConfirmId: choreActions.completeConfirmId,
		confirmSuggestion: create.confirmSuggestion,
		fairness,
		handleAssignedMemberIdChange: create.handleAssignedMemberIdChange,
		handleComplete: choreActions.handleComplete,
		handleIntervalPresetSelect: create.handleIntervalPresetSelect,
		handleRecurrenceUnitToggle: create.handleRecurrenceUnitToggle,
		handleRemove: choreActions.handleRemove,
		handleSwapRequest: choreActions.handleSwapRequest,
		handleTakeOver: choreActions.handleTakeOver,
		hiddenAbsenceCount: absences.length - visibleAbsences.length,
		highlightedId,
		initialLoading,
		isPending,
		items,
		load: data.load,
		loadError,
		memberLookup,
		monthCompletions: data.monthCompletions,
		newAssigned: create.newAssigned,
		newInterval: create.newInterval,
		newRecurrenceType: create.newRecurrenceType,
		newTitle: create.newTitle,
		nextAssigneeNameByChoreId,
		ownDueCount,
		pendingSuggestion: create.pendingSuggestion,
		queuedCount: data.queuedCount,
		refreshing: data.refreshing,
		removeAbsence: absenceActions.removeAbsence,
		addAbsence: absenceActions.addAbsence,
		add: create.add,
		setAbsenceEnd: absenceForm.setAbsenceEnd,
		setAbsenceMemberId: absenceForm.setAbsenceMemberId,
		setAbsenceReason: absenceForm.setAbsenceReason,
		setAbsenceStart: absenceForm.setAbsenceStart,
		setCompleteConfirmId: choreActions.setCompleteConfirmId,
		setConfirmSuggestion: create.setConfirmSuggestion,
		setNewTitle: create.setNewTitle,
		setShowForm: create.setShowForm,
		health: getChorePlanHealth(items),
		showForm: create.showForm,
		showSkeleton,
		titleInputRef: create.titleInputRef,
		visibleAbsences,
	};
}
