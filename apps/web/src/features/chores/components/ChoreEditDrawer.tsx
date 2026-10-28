'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	Drawer,
	DrawerContent,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/components/ui/drawer';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { dueDayKey } from '@/features/chores/chore-due-date';
import { type ChoreEditChanges, diffChoreEdit } from '@/features/chores/chore-edit';
import { CHORE_TITLE_MAX } from '@/features/chores/chore-limits';
import type { Chore, ChoreMember } from '@/features/chores/components/chore-types';
import {
	INTERVAL_PRESETS_DAYS,
	INTERVAL_PRESETS_MONTHS,
} from '@/features/chores/components/constants';
import { useMessage } from '@/shared/i18n/message';
import { useTranslations } from 'next-intl';
import { type ReactElement, useState } from 'react';

interface ChoreEditDrawerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	chore: Chore;
	members: ChoreMember[];
	pending: boolean;
	error: string | null;
	onSave: (changes: ChoreEditChanges) => void;
}

const PRESETS = [...INTERVAL_PRESETS_DAYS, ...INTERVAL_PRESETS_MONTHS];
const presetValue = (interval: number, unit: string): string => `${unit}:${interval}`;

function EditFields({
	chore,
	members,
	pending,
	error,
	onSave,
	onClose,
}: Omit<ChoreEditDrawerProps, 'open' | 'onOpenChange'> & { onClose: () => void }): ReactElement {
	const t = useTranslations('chores.editDrawer');
	const render = useMessage();
	const [title, setTitle] = useState(chore.title);
	const [assigned, setAssigned] = useState(chore.assignedMemberId ?? '');
	const [dueDay, setDueDay] = useState(dueDayKey(chore.nextDueAt));
	const [interval, setInterval] = useState(chore.intervalDays);
	const [recurrenceType, setRecurrenceType] = useState(chore.recurrenceType);
	const changes = diffChoreEdit(chore, { title, assigned, dueDay, interval, recurrenceType });
	const canSave = Object.keys(changes).length > 0 && title.trim().length > 0 && !pending;

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (canSave) onSave(changes);
			}}
			className="flex min-h-0 flex-col"
		>
			<div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
				<FieldGroup>
					<Field data-disabled={pending}>
						<FieldLabel htmlFor={`chore-edit-title-${chore.id}`}>{t('task')}</FieldLabel>
						<Input
							id={`chore-edit-title-${chore.id}`}
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							maxLength={CHORE_TITLE_MAX}
							disabled={pending}
							enterKeyHint="done"
							className="text-base"
						/>
					</Field>
					<Field data-disabled={pending}>
						<FieldLabel htmlFor={`chore-edit-assigned-${chore.id}`}>{t('assigned')}</FieldLabel>
						<NativeSelect
							id={`chore-edit-assigned-${chore.id}`}
							value={assigned}
							onChange={(event) => setAssigned(event.target.value)}
							disabled={pending}
							className="w-full [&_select]:min-h-11 [&_select]:text-base"
						>
							<NativeSelectOption value="">{t('nobody')}</NativeSelectOption>
							{members.map((member) => (
								<NativeSelectOption key={member.id} value={member.id}>
									{member.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
					<Field data-disabled={pending}>
						<FieldLabel htmlFor={`chore-edit-due-${chore.id}`}>{t('dueOn')}</FieldLabel>
						<Input
							id={`chore-edit-due-${chore.id}`}
							type="date"
							value={dueDay}
							onChange={(event) => setDueDay(event.target.value)}
							disabled={pending}
							className="min-w-0 text-base"
						/>
					</Field>
					<Field data-disabled={pending}>
						<FieldLabel id={`chore-edit-rhythm-${chore.id}`}>{t('rhythm')}</FieldLabel>
						<ToggleGroup
							value={[presetValue(interval, recurrenceType)]}
							onValueChange={(values) => {
								const preset = PRESETS.find(
									(entry) => presetValue(entry.interval, entry.unit) === values[0],
								);
								if (!preset) return;
								setInterval(preset.interval);
								setRecurrenceType(preset.unit);
							}}
							variant="outline"
							aria-labelledby={`chore-edit-rhythm-${chore.id}`}
							className="w-full flex-wrap"
						>
							{PRESETS.map((preset) => (
								<ToggleGroupItem
									key={presetValue(preset.interval, preset.unit)}
									value={presetValue(preset.interval, preset.unit)}
									disabled={pending}
								>
									{render(preset.label)}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</Field>
				</FieldGroup>
			</div>
			{error && (
				<div className="max-h-[35dvh] shrink-0 overflow-y-auto px-4 pb-3">
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				</div>
			)}
			<DrawerFooter className="flex-row flex-wrap border-t pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
				<Button type="submit" disabled={!canSave} className="min-h-11 flex-1">
					{pending && <Spinner data-icon="inline-start" aria-hidden />}
					{pending ? t('saving') : t('save')}
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={onClose}
					disabled={pending}
					className="min-h-11 flex-1"
				>
					{t('cancel')}
				</Button>
			</DrawerFooter>
		</form>
	);
}

/** Fix a typo, the rhythm, the due day or the assignee of an existing chore. */
export function ChoreEditDrawer({
	open,
	onOpenChange,
	...fields
}: ChoreEditDrawerProps): ReactElement {
	const t = useTranslations('chores.editDrawer');
	return (
		<Drawer
			open={open}
			onOpenChange={(next) => {
				if (!next && fields.pending) return;
				onOpenChange(next);
			}}
		>
			<DrawerContent className="mx-auto w-full max-w-md">
				<DrawerHeader>
					<DrawerTitle>{t('title')}</DrawerTitle>
				</DrawerHeader>
				{/* Mounted only while open so every opening starts from the stored chore. */}
				{open && <EditFields {...fields} onClose={() => onOpenChange(false)} />}
			</DrawerContent>
		</Drawer>
	);
}
