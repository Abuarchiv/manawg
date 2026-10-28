'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Collapsible, CollapsiblePanel } from '@/components/animate-ui/primitives/base/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemEntry,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { useConfirmDelete } from '@/core/hooks/use-confirm-delete';
import { berlinDayKey } from '@/core/utils/berlin-day';
import { formatShortDateRange } from '@/core/utils/time';
import type { AbsenceInput } from '@/features/chores/absence';
import { ABSENCE_REASON_MAX } from '@/features/chores/chore-limits';
import type { ChoreMember } from '@/features/chores/components/chore-types';
import { pendingKeys } from '@/features/chores/pending-keys';
import type { Locale } from '@/shared/i18n/locale';
import { cn } from '@/shared/lib/cn';

interface AbsencePanelProps {
	active: boolean;
	absentCount: number;
	members: ChoreMember[];
	memberId: string;
	onMemberIdChange: (value: string) => void;
	start: string;
	onStartChange: (value: string) => void;
	end: string;
	onEndChange: (value: string) => void;
	reason: string;
	onReasonChange: (value: string) => void;
	pending: boolean;
	onAdd: () => void;
	hiddenCount: number;
	totalCount: number;
	allAbsencesHref: string;
	visibleAbsences: AbsenceInput[];
	highlightedAbsenceId: string | null;
	/** Row briefly tinted after a deep link; resets to null after a few seconds. */
	flashedAbsenceId: string | null;
	onRemove: (id: string) => void;
	isPending: (key: string) => boolean;
	/** Error while adding: shown in the form above the save button. */
	error: string | null;
	/** Error while removing: shown above the list. */
	listError: string | null;
}

export function AbsencePanel({
	active,
	absentCount,
	members,
	memberId,
	onMemberIdChange,
	start,
	onStartChange,
	end,
	onEndChange,
	reason,
	onReasonChange,
	pending,
	onAdd,
	hiddenCount,
	totalCount,
	allAbsencesHref,
	visibleAbsences,
	highlightedAbsenceId,
	flashedAbsenceId,
	onRemove,
	isPending,
	error,
	listError,
}: AbsencePanelProps) {
	const t = useTranslations('chores.absence');
	const locale = useLocale() as Locale;
	// With ?absence=<id> the user expects to see that row, not an empty form.
	const openForm = active && !highlightedAbsenceId;
	const [formOpen, setFormOpen] = useState(openForm || Boolean(start || end || reason));
	const { confirmId, request: requestRemove, cancel: cancelRemove } = useConfirmDelete();
	useEffect(() => {
		if (openForm || start || end || reason) setFormOpen(true);
	}, [openForm, start, end, reason]);
	// An open, empty form starts with today: otherwise WebKit displays a date while the button stays disabled.
	useEffect(() => {
		if (!formOpen || start || end) return;
		const today = berlinDayKey(new Date());
		onStartChange(today);
		onEndChange(today);
	}, [formOpen, start, end, onStartChange, onEndChange]);
	function toggleForm() {
		if (formOpen) {
			// Otherwise the effect above reopens the form immediately.
			onStartChange('');
			onEndChange('');
			onReasonChange('');
		}
		setFormOpen(!formOpen);
	}

	return (
		<Card id="absences-panel" className={cn('scroll-mt-28', openForm && 'ring-2 ring-ring')}>
			<CardHeader className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex min-w-fit flex-1 flex-col gap-1">
					<CardTitle className="break-normal">{t('title')}</CardTitle>
					{absentCount > 0 && (
						<CardDescription className="break-normal">
							{t('currentlyAway', { count: String(absentCount) })}
						</CardDescription>
					)}
				</div>
				<CardAction>
					<Button
						variant="outline"
						size="sm"
						onClick={toggleForm}
						aria-label={formOpen ? t('closeFormAria') : t('openFormAria')}
						aria-expanded={formOpen}
						aria-controls="absence-form"
					>
						{formOpen ? t('close') : t('enter')}
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent
				className={cn(
					'flex flex-col gap-0',
					!formOpen && totalCount === 0 && !listError && 'hidden',
				)}
			>
				<Collapsible open={formOpen}>
					<CollapsiblePanel>
						<form
							id="absence-form"
							onSubmit={(event) => {
								event.preventDefault();
								onAdd();
							}}
							noValidate
							className={cn(
								'flex flex-col gap-3 pt-3',
								// Room for the thumb bar only when no list follows.
								totalCount === 0 ? 'pb-[calc(0.75rem+var(--thumb-action-space,0px))]' : 'pb-3',
							)}
						>
							<FieldGroup>
								<Field data-disabled={pending}>
									<FieldLabel htmlFor="absence-member">{t('member')}</FieldLabel>
									<NativeSelect
										id="absence-member"
										value={memberId}
										onChange={(event) => onMemberIdChange(event.target.value)}
										disabled={pending}
										className="w-full [&_select]:min-h-11 [&_select]:text-base"
									>
										{members.map((member) => (
											<NativeSelectOption key={member.id} value={member.id}>
												{member.name}
											</NativeSelectOption>
										))}
									</NativeSelect>
								</Field>
								<FieldGroup className="grid grid-cols-1 gap-2">
									<Field data-disabled={pending} className="min-w-0">
										<FieldLabel htmlFor="absence-start">{t('from')}</FieldLabel>
										<Input
											id="absence-start"
											type="date"
											value={start}
											onChange={(event) => {
												const value = event.target.value;
												onStartChange(value);
												// A single day is the most common case: "until" follows "from" while it is empty or earlier.
												if (value && (!end || end < value)) onEndChange(value);
											}}
											disabled={pending}
											aria-label={t('fromAria')}
											className="min-w-0 text-base"
										/>
									</Field>
									<Field data-disabled={pending} className="min-w-0">
										<FieldLabel htmlFor="absence-end">{t('until')}</FieldLabel>
										<Input
											id="absence-end"
											type="date"
											value={end}
											onChange={(event) => onEndChange(event.target.value)}
											min={start || undefined}
											disabled={pending}
											aria-label={t('untilAria')}
											className="min-w-0 text-base"
										/>
									</Field>
									{(!start || !end) && (
										<FieldDescription className="text-xs">{t('pickRange')}</FieldDescription>
									)}
								</FieldGroup>
								<Field data-disabled={pending}>
									<FieldLabel htmlFor="absence-reason">{t('reason')}</FieldLabel>
									<Input
										id="absence-reason"
										value={reason}
										onChange={(event) => onReasonChange(event.target.value)}
										maxLength={ABSENCE_REASON_MAX}
										placeholder={t('reasonPlaceholder')}
										disabled={pending}
										enterKeyHint="done"
										className="text-base"
									/>
								</Field>
							</FieldGroup>
							{error && (
								<Alert variant="destructive">
									<AlertDescription>{error}</AlertDescription>
								</Alert>
							)}
							<Button type="submit" disabled={!start || !end || pending} aria-label={t('saveAria')}>
								{pending && <Spinner data-icon="inline-start" aria-hidden />}
								{pending ? t('saving') : t('save')}
							</Button>
						</form>
					</CollapsiblePanel>
				</Collapsible>
				{listError && (
					<Alert variant="destructive" className="mt-3">
						<AlertDescription>{listError}</AlertDescription>
					</Alert>
				)}
				{totalCount > 0 && (
					<ItemGroup className="gap-0 divide-y">
						{visibleAbsences.map((absence) => {
							const removing = isPending(pendingKeys.absenceRemove(absence.id));
							const armed = confirmId === absence.id;
							return (
								<ItemEntry
									key={absence.id}
									id={`absence-${absence.id}`}
									className={cn(
										// The tint extends 0.5 rem beyond the text so it does not touch the edge.
										'scroll-mt-28 -mx-2 w-[calc(100%+1rem)] max-w-none rounded-none px-2 transition-colors duration-700',
										absence.id === flashedAbsenceId && 'bg-primary/10',
									)}
								>
									<ItemContent className="min-w-0 basis-36">
										<ItemTitle className="line-clamp-none break-words">
											{absence.memberName}
										</ItemTitle>
										<ItemDescription className="line-clamp-none">
											{formatShortDateRange(absence.startDate, absence.endDate, locale)}
										</ItemDescription>
										{absence.reason && (
											<ItemDescription className="line-clamp-none break-words">
												{absence.reason}
											</ItemDescription>
										)}
									</ItemContent>
									<ItemActions className="ml-auto gap-2">
										<Button
											variant={armed ? 'destructive' : 'outline'}
											disabled={removing}
											onClick={() => {
												if (requestRemove(absence.id)) onRemove(absence.id);
											}}
											aria-label={t(armed ? 'removeConfirmAria' : 'removeAria', {
												name: absence.memberName,
												range: formatShortDateRange(absence.startDate, absence.endDate, locale),
											})}
										>
											{removing && <Spinner data-icon="inline-start" aria-hidden />}
											{armed ? t('removeConfirm') : t('remove')}
										</Button>
										{armed && (
											<Button
												variant="outline"
												disabled={removing}
												onClick={() => cancelRemove()}
												aria-label={t('cancelRemoveAria', { name: absence.memberName })}
											>
												{t('cancel')}
											</Button>
										)}
									</ItemActions>
								</ItemEntry>
							);
						})}
					</ItemGroup>
				)}
				{hiddenCount > 0 && (
					<Link
						href={allAbsencesHref}
						className={cn(buttonVariants({ variant: 'outline' }), 'mt-3 min-h-11')}
					>
						{t('showAll', { count: String(totalCount) })}
					</Link>
				)}
			</CardContent>
		</Card>
	);
}
