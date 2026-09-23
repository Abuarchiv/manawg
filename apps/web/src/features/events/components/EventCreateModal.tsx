'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/components/ui/drawer';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { EventFormFields } from '@/features/events/components/EventFormFields';
import {
	RECURRENCE_OPTIONS,
	type RecurrenceFreq,
	formatRecurrenceRule,
	validateEventForm,
} from '@/features/events/events';
import { useEffect, useRef, useState } from 'react';

interface EventCreateModalProps {
	open: boolean;
	onClose: () => void;
	onSubmit: (payload: CreateEventPayload) => Promise<void>;
	defaultDate?: Date | undefined;
}

export interface CreateEventPayload {
	title: string;
	description: string | null;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	location: string | null;
	recurrence: string | null;
}

const QUICK_TEMPLATES: ReadonlyArray<{
	label: string;
	title: string;
	recurrence: string | null;
	allDay: boolean;
}> = [
	{ label: 'Geburtstag', title: 'Geburtstag', recurrence: 'FREQ=YEARLY', allDay: true },
	{
		label: 'Heizungsablesung',
		title: 'Heizungsablesung',
		recurrence: 'FREQ=YEARLY',
		allDay: true,
	},
	{ label: 'Stromableser', title: 'Stromableser kommt', recurrence: null, allDay: false },
	{ label: 'WG-Meeting', title: 'WG-Meeting', recurrence: 'FREQ=WEEKLY;BYDAY=MO', allDay: false },
	{ label: 'Müll raus', title: 'Müll raus', recurrence: 'FREQ=WEEKLY', allDay: false },
];

function buildIsoLocal(date: Date): string {
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
		date.getHours(),
	)}:${pad(date.getMinutes())}`;
}

export function EventCreateModal({ open, onClose, onSubmit, defaultDate }: EventCreateModalProps) {
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [startsAt, setStartsAt] = useState('');
	const [endsAt, setEndsAt] = useState('');
	const [allDay, setAllDay] = useState(false);
	const [location, setLocation] = useState('');
	const [recurrenceFreq, setRecurrenceFreq] = useState<string>('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const draftInitializedRef = useRef(false);

	useEffect(() => {
		if (!open || draftInitializedRef.current) return;
		draftInitializedRef.current = true;
		setError(null);
		const seed = defaultDate ?? new Date();
		const seeded = new Date(seed);
		seeded.setMinutes(0, 0, 0);
		setStartsAt(buildIsoLocal(seeded));
		setEndsAt('');
	}, [open, defaultDate]);

	function applyTemplate(template: (typeof QUICK_TEMPLATES)[number]): void {
		setTitle(template.title);
		setAllDay(template.allDay);
		const freq = template.recurrence ? template.recurrence.replace(/.*FREQ=([A-Z]+).*/, '$1') : '';
		setRecurrenceFreq(freq);
	}

	async function handleSubmit(e: React.FormEvent): Promise<void> {
		e.preventDefault();
		if (submitting) return;
		setError(null);
		const validation = validateEventForm({ title, startsAt, endsAt, allDay });
		if (!validation.ok) {
			setError(validation.error);
			return;
		}
		const trimmedTitle = title.trim();
		const startDate = validation.startsAt;
		const endDate = validation.endsAt;
		const recurrence = recurrenceFreq
			? formatRecurrenceRule({ freq: recurrenceFreq as RecurrenceFreq, interval: 1 })
			: null;
		setSubmitting(true);
		try {
			await onSubmit({
				title: trimmedTitle,
				description: description.trim() || null,
				startsAt: startDate.toISOString(),
				endsAt: endDate ? endDate.toISOString() : null,
				allDay,
				location: location.trim() || null,
				recurrence,
			});
			draftInitializedRef.current = false;
			setStartsAt('');
			setEndsAt('');
			setTitle('');
			setDescription('');
			setLocation('');
			setAllDay(false);
			setRecurrenceFreq('');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Termin konnte nicht gespeichert werden.');
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Drawer
			open={open}
			onOpenChange={(next) => {
				if (!next && !submitting) onClose();
			}}
		>
			<DrawerContent className="mx-auto w-full max-w-md">
				<DrawerHeader>
					<DrawerTitle>Neuer Termin</DrawerTitle>
					<DrawerDescription>
						Für eure WG · Datum und Uhrzeit wie auf deinem Gerät.
					</DrawerDescription>
				</DrawerHeader>
				<form
					onSubmit={handleSubmit}
					className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
				>
					<details>
						<summary className="min-h-11 cursor-pointer py-3 text-xs text-muted-foreground">
							Vorlage verwenden
						</summary>
						<FieldSet disabled={submitting}>
							<FieldLegend variant="label" className="sr-only">
								Schnellvorlagen
							</FieldLegend>
							<div className="flex flex-wrap gap-2">
								{QUICK_TEMPLATES.map((template) => (
									<Button
										key={template.label}
										type="button"
										variant="outline"
										onClick={() => applyTemplate(template)}
										disabled={submitting}
									>
										{template.label}
									</Button>
								))}
							</div>
						</FieldSet>
					</details>
					<EventFormFields
						idPrefix="event-create"
						title={title}
						onTitleChange={setTitle}
						startsAt={startsAt}
						onStartsAtChange={setStartsAt}
						endsAt={endsAt}
						onEndsAtChange={setEndsAt}
						allDay={allDay}
						onAllDayChange={setAllDay}
						location={location}
						onLocationChange={setLocation}
						description={description}
						onDescriptionChange={setDescription}
						disabled={submitting}
						recurrenceField={
							<Field data-disabled={submitting}>
								<FieldLabel htmlFor="event-recurrence">Wiederholung</FieldLabel>
								<NativeSelect
									id="event-recurrence"
									value={recurrenceFreq}
									onChange={(event) => setRecurrenceFreq(event.target.value)}
									disabled={submitting}
									className="w-full [&_select]:min-h-11 [&_select]:text-base"
								>
									{RECURRENCE_OPTIONS.map((option) => (
										<NativeSelectOption key={option.value} value={option.value}>
											{option.label}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>
						}
					/>
					{error && (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}
					<DrawerFooter className="p-0">
						<Button type="submit" disabled={submitting} aria-label="Termin speichern">
							{submitting && <Spinner data-icon="inline-start" aria-hidden />}
							{submitting ? 'Speichert…' : 'Termin speichern'}
						</Button>
						<Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
							Schließen · Entwurf behalten
						</Button>
					</DrawerFooter>
				</form>
			</DrawerContent>
		</Drawer>
	);
}
