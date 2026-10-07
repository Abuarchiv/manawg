'use client';

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
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { useConfirmDelete } from '@/core/hooks/useConfirmDelete';
import { formatShortDateRange } from '@/core/utils/time';
import type { AbsenceInput } from '@/features/chores/absence';
import type { ChoreMember } from '@/features/chores/components/chore-types';
import { cn } from '@/shared/lib/cn';
import Link from 'next/link';
import { useEffect, useState } from 'react';

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
	onRemove: (id: string) => void;
	isPending: (key: string) => boolean;
	/** Fehler beim Eintragen: steht im Formular über dem Speichern-Knopf. */
	error: string | null;
	/** Fehler beim Entfernen: steht über der Liste. */
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
	onRemove,
	isPending,
	error,
	listError,
}: AbsencePanelProps) {
	// Mit ?absence=<id> will man die Zeile sehen, nicht ein leeres Formular.
	const openForm = active && !highlightedAbsenceId;
	const [formOpen, setFormOpen] = useState(openForm || Boolean(start || end || reason));
	const { confirmId, request: requestRemove, cancel: cancelRemove } = useConfirmDelete();
	useEffect(() => {
		if (openForm || start || end || reason) setFormOpen(true);
	}, [openForm, start, end, reason]);

	return (
		<Card id="absences-panel" className={cn('scroll-mt-28', openForm && 'ring-2 ring-ring')}>
			<CardHeader className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex min-w-fit flex-1 flex-col gap-1">
					<CardTitle className="break-normal">Abwesenheiten</CardTitle>
					{absentCount > 0 && (
						<CardDescription className="break-normal">
							{`${absentCount} aktuell abwesend`}
						</CardDescription>
					)}
				</div>
				<CardAction>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setFormOpen((open) => !open)}
						aria-label={formOpen ? 'Abwesenheitsformular schließen' : 'Abwesenheit eintragen'}
						aria-expanded={formOpen}
						aria-controls="absence-form"
					>
						{formOpen ? 'Schließen' : 'Eintragen'}
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
							className={cn(
								'flex flex-col gap-3 pt-3',
								// Platz für die Daumen-Leiste nur, wenn keine Liste mehr folgt.
								totalCount === 0 ? 'pb-[calc(0.75rem+var(--thumb-action-space,0px))]' : 'pb-3',
							)}
						>
							<FieldGroup>
								<Field data-disabled={pending}>
									<FieldLabel htmlFor="absence-member">Abwesendes Mitglied</FieldLabel>
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
										<FieldLabel htmlFor="absence-start">Von</FieldLabel>
										<Input
											id="absence-start"
											type="date"
											value={start}
											onChange={(event) => {
												const value = event.target.value;
												onStartChange(value);
												// Ein Tag ist der häufigste Fall: Bis folgt Von, solange es leer oder davor liegt.
												if (value && (!end || end < value)) onEndChange(value);
											}}
											disabled={pending}
											aria-label="Abwesenheit von"
											className="min-w-0 text-base"
										/>
									</Field>
									<Field data-disabled={pending} className="min-w-0">
										<FieldLabel htmlFor="absence-end">Bis</FieldLabel>
										<Input
											id="absence-end"
											type="date"
											value={end}
											onChange={(event) => onEndChange(event.target.value)}
											min={start || undefined}
											disabled={pending}
											aria-label="Abwesenheit bis"
											className="min-w-0 text-base"
										/>
									</Field>
									{(!start || !end) && (
										<FieldDescription className="text-xs">
											Wähle Von und Bis, dann kannst du speichern.
										</FieldDescription>
									)}
								</FieldGroup>
								<Field data-disabled={pending}>
									<FieldLabel htmlFor="absence-reason">Grund (optional)</FieldLabel>
									<Input
										id="absence-reason"
										value={reason}
										onChange={(event) => onReasonChange(event.target.value)}
										maxLength={120}
										placeholder="z. B. Urlaub"
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
							<Button
								type="submit"
								disabled={!start || !end || pending}
								aria-label="Abwesenheit speichern"
							>
								{pending && <Spinner data-icon="inline-start" aria-hidden />}
								{pending ? 'Speichert…' : 'Abwesenheit speichern'}
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
							const removing = isPending(`absence:${absence.id}:remove`);
							const armed = confirmId === absence.id;
							return (
								<Item
									key={absence.id}
									id={`absence-${absence.id}`}
									className={cn(
										'scroll-mt-28 px-0',
										absence.id === highlightedAbsenceId && 'ring-2 ring-inset ring-ring',
									)}
								>
									<ItemContent className="min-w-0 basis-36">
										<ItemTitle className="line-clamp-none break-words">
											{absence.memberName}
										</ItemTitle>
										<ItemDescription className="line-clamp-none">
											{formatShortDateRange(absence.startDate, absence.endDate)}
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
											aria-label={`Abwesenheit von ${absence.memberName} (${formatShortDateRange(absence.startDate, absence.endDate)}) ${armed ? 'endgültig entfernen' : 'entfernen'}`}
										>
											{removing && <Spinner data-icon="inline-start" aria-hidden />}
											{armed ? 'Wirklich entfernen?' : 'Entfernen'}
										</Button>
										{armed && (
											<Button
												variant="outline"
												disabled={removing}
												onClick={() => cancelRemove()}
												aria-label={`Entfernen von Abwesenheit ${absence.memberName} abbrechen`}
											>
												Abbrechen
											</Button>
										)}
									</ItemActions>
								</Item>
							);
						})}
					</ItemGroup>
				)}
				{hiddenCount > 0 && (
					<Link
						href={allAbsencesHref}
						className={buttonVariants({ variant: 'outline', className: 'mt-3 min-h-11' })}
					>
						Alle {totalCount} Abwesenheiten anzeigen
					</Link>
				)}
			</CardContent>
		</Card>
	);
}
