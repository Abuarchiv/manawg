import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useWg } from '@/components/wg/WgContextProvider';
import { usePendingSet } from '@/core/hooks/use-pending-set';
import {
	getAbsentAssigneeChoreIds,
	getAbsentMemberIds,
	pickVisibleAbsences,
} from '@/features/chores/absence';
import type { NextAssignee } from '@/features/chores/chore-completion';
import { buildChoreFairness, predictNextAssigneeId } from '@/features/chores/chore-fairness';
import {
	filterOverdueGroups,
	getChorePlanHealth,
	getChoreStatus,
	groupChoresForPlan,
} from '@/features/chores/chore-status';
import { pendingKeys } from '@/features/chores/pending-keys';
import type { MemberInfo } from '@/shared/lib/member-types';
import type { ChorePageContext } from './chore-page-context';
import { useAbsenceFormState, useAbsences } from './use-absences';
import { useChoreActions } from './use-chore-actions';
import { useChoreCreate } from './use-chore-create';
import { useChoresData } from './use-chores-data';

/** Delay before a deep-linked row is scrolled into view, so the list has laid out. */
const SCROLL_DELAY_MS = 80;
/** How long a deep-linked row stays highlighted. */
const FLASH_MS = 2500;

/** The chore plan page: ties loading, creating, actions and absences together and derives the view. */
export function usePutzenPage() {
	const { wg, members, identity } = useWg();
	const toast = useToast();
	const t = useTranslations('chores.shared');
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const searchParams = useSearchParams();
	const highlightParam = searchParams.get('highlight');
	const prefillTitle = searchParams.get('title');
	const overdueFilterActive = searchParams.get('filter') === 'overdue';
	const absencesPanelActive = searchParams.get('panel') === 'absences';
	const absenceParam = searchParams.get('absence');
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

	// The highlight is a brief hint, not a selection state: it fades after FLASH_MS.
	const [flashId, setFlashId] = useState<string | null>(null);
	const hasItems = items.length > 0;
	useEffect(() => {
		if (!highlightParam || !hasItems) return;
		setFlashId(highlightParam);
		const scrollTimer = window.setTimeout(() => {
			document.getElementById(`chore-${highlightParam}`)?.scrollIntoView({
				block: 'center',
			});
		}, SCROLL_DELAY_MS);
		const clearTimer = window.setTimeout(() => setFlashId(null), FLASH_MS);
		return () => {
			window.clearTimeout(scrollTimer);
			window.clearTimeout(clearTimer);
		};
	}, [highlightParam, hasItems]);

	// `?filter=overdue` shows only overdue chores until "Alle anzeigen" is tapped.
	const [showAllChores, setShowAllChores] = useState(false);

	// The row exists only after loading; without it in the dependencies the scroll would target nothing.
	const absenceRowExists = absenceParam
		? absences.some((absence) => absence.id === absenceParam)
		: false;
	const [flashAbsenceId, setFlashAbsenceId] = useState<string | null>(null);
	useEffect(() => {
		if ((!absencesPanelActive && !absenceParam) || initialLoading) return;
		if (absenceRowExists) setFlashAbsenceId(absenceParam);
		const scrollTimer = window.setTimeout(() => {
			if (absenceRowExists) {
				document.getElementById(`absence-${absenceParam}`)?.scrollIntoView({ block: 'center' });
				return;
			}
			document.getElementById('absences-panel')?.scrollIntoView({
				block: 'start',
			});
		}, SCROLL_DELAY_MS);
		const clearTimer = window.setTimeout(() => setFlashAbsenceId(null), FLASH_MS);
		return () => {
			window.clearTimeout(scrollTimer);
			window.clearTimeout(clearTimer);
		};
	}, [absenceParam, absenceRowExists, absencesPanelActive, initialLoading]);

	// Editing the absence form dismisses the previous save error.
	const withClearedError = (setField: (value: string) => void) => (value: string) => {
		absenceActions.clearAbsenceError();
		setField(value);
	};

	function memberLookup(id: string | null): MemberInfo {
		if (!id) return { name: t('nobody'), color: null };
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
	const allChoreGroups = useMemo(() => {
		const absentAssigneeChoreIds = getAbsentAssigneeChoreIds(items, absences);
		return groupChoresForPlan(
			items.map((chore) => ({ ...chore, assigneeAbsent: absentAssigneeChoreIds.has(chore.id) })),
			identity.memberId,
		);
	}, [absences, identity.memberId, items]);
	const overdueGroups = useMemo(() => filterOverdueGroups(allChoreGroups), [allChoreGroups]);
	// Once nothing is overdue anymore (e.g. after completing the last one) the full list returns.
	const overdueFilter = {
		active: overdueFilterActive && !showAllChores && overdueGroups.length > 0,
		showAll: () => setShowAllChores(true),
	};
	const choreGroups = overdueFilter.active ? overdueGroups : allChoreGroups;
	const visibleAbsences = useMemo(
		() => pickVisibleAbsences(absences, absencesPanelActive, absenceParam),
		[absenceParam, absences, absencesPanelActive],
	);
	const nextAssigneeByChoreId = new Map<string, NextAssignee | null>(
		items.map((chore): [string, NextAssignee | null] => {
			const nextAssigneeId = predictNextAssigneeId(chore, items, activeMembers, absences);
			if (!nextAssigneeId) return [chore.id, null];
			const isSelf = nextAssigneeId === identity.memberId;
			return [
				chore.id,
				{ name: isSelf ? identity.name : memberLookup(nextAssigneeId).name, isSelf },
			];
		}),
	);

	return {
		activeMembers,
		absenceAddPending: isPending(pendingKeys.ABSENCE_ADD),
		absenceEnd: absenceForm.absenceEnd,
		absenceError: absenceActions.absenceError,
		absenceListError: absenceActions.absenceListError,
		absenceParam,
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
		choreAddPending: isPending(pendingKeys.CHORE_ADD),
		choreGroups,
		overdueFilter,
		completeConfirmId: choreActions.completeConfirmId,
		confirmSuggestion: create.confirmSuggestion,
		fairness,
		flashAbsenceId,
		handleAssignedMemberIdChange: create.handleAssignedMemberIdChange,
		handleComplete: choreActions.handleComplete,
		handleEdit: choreActions.handleEdit,
		handleIntervalPresetSelect: create.handleIntervalPresetSelect,
		handleRecurrenceUnitToggle: create.handleRecurrenceUnitToggle,
		handleRemove: choreActions.handleRemove,
		handleSwapRequest: choreActions.handleSwapRequest,
		swapRequestedIds: choreActions.swapRequestedIds,
		handleTakeOver: choreActions.handleTakeOver,
		hiddenAbsenceCount: absences.length - visibleAbsences.length,
		highlightedId: flashId,
		initialLoading,
		isPending,
		items,
		load: data.load,
		loadError,
		memberLookup,
		monthCompletions: data.monthCompletions,
		newAssigned: create.newAssigned,
		newFirstDue: create.newFirstDue,
		newInterval: create.newInterval,
		newRecurrenceType: create.newRecurrenceType,
		newTitle: create.newTitle,
		nextAssigneeByChoreId,
		ownDueCount,
		pendingSuggestion: create.pendingSuggestion,
		queuedCount: data.queuedCount,
		refreshing: data.refreshing,
		removeAbsence: absenceActions.removeAbsence,
		addAbsence: absenceActions.addAbsence,
		add: create.add,
		setAbsenceEnd: withClearedError(absenceForm.setAbsenceEnd),
		setAbsenceMemberId: withClearedError(absenceForm.setAbsenceMemberId),
		setAbsenceReason: withClearedError(absenceForm.setAbsenceReason),
		setAbsenceStart: withClearedError(absenceForm.setAbsenceStart),
		cancelComplete: choreActions.cancelComplete,
		setConfirmSuggestion: create.setConfirmSuggestion,
		setNewFirstDue: create.setNewFirstDue,
		setNewTitle: create.setNewTitle,
		setShowForm: create.setShowForm,
		health: getChorePlanHealth(items),
		showForm: create.showForm,
		showSkeleton,
		titleInputRef: create.titleInputRef,
		visibleAbsences,
	};
}
