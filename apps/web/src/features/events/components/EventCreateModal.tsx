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
import { EventFormFields, focusEventField } from '@/features/events/components/EventFormFields';
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
	// Das Formular kennt nur die Frequenz; ein BYDAY wäre stillschweigend verworfen worden.
	{ label: 'WG-Meeting', title: 'WG-Meeting', recurrence: 'FREQ=WEEKLY', allDay: false },
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
	const [errorField, setErrorField] = useState<'title' | 'startsAt' | 'endsAt' | null>(null);
	// Die Meldung sitzt unter den Feldern, der Speichern-Button ist angeheftet.
	useEffect(() => {
		if (error) document.getElementById('event-create-error')?.scrollIntoView({ block: 'nearest' });
	}, [error]);
	// Zuletzt angetippte Vorlage; solange gesetzt, darf eine andere Vorlage den Titel ersetzen.
	const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
	function clearErrorFor(...fields: Array<'title' | 'startsAt' | 'endsAt'>): void {
		if (errorField && fields.includes(errorField)) {
			setErrorField(null);
			setError(null);
		}
	}
	const draftInitializedRef = useRef(false);
	// Tag, mit dem der Entwurf zuletzt vorbelegt wurde.
	const lastSeedDayRef = useRef('');

	// biome-ignore lint/correctness/useExhaustiveDependencies: nur beim Öffnen bzw. neuem Tag vorbelegen, nicht bei jedem Tastendruck.
	useEffect(() => {
		if (!open) return;
		const day = defaultDate?.toDateString() ?? '';
		// Ein unberührter Entwurf folgt dem neu gewählten Tag, ein begonnener bleibt erhalten.
		const pristine = !title && !description && !location && !endsAt && !allDay && !recurrenceFreq;
		if (draftInitializedRef.current && !(pristine && day !== lastSeedDayRef.current)) return;
		draftInitializedRef.current = true;
		lastSeedDayRef.current = day;
		setActiveTemplate(null);
		setError(null);
		setErrorField(null);
		// Start at the next full hour; a picked day keeps that time of day
		// (including a day picked in the past — the calendar lets you select
		// one, so silently discarding it back to "today" would be confusing).
		const nextHour = new Date();
		nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
		const seeded = new Date(defaultDate ?? nextHour);
		seeded.setHours(nextHour.getHours(), 0, 0, 0);
		// Today after 23:00 would seed 00:00 of today, which has already passed.
		const pickedToday = seeded.toDateString() === new Date().toDateString();
		setStartsAt(buildIsoLocal(pickedToday && seeded < nextHour ? nextHour : seeded));
		setEndsAt('');
	}, [open, defaultDate]);

	function applyTemplate(template: (typeof QUICK_TEMPLATES)[number]): void {
		// Ein selbst getippter Titel bleibt; nur leere oder von einer Vorlage stammende Titel werden ersetzt.
		const previous = QUICK_TEMPLATES.find((t) => t.label === activeTemplate);
		if (!title || title === previous?.title) setTitle(template.title);
		setActiveTemplate(template.label);
		clearErrorFor('title');
		setAllDay(template.allDay);
		const freq = template.recurrence ? template.recurrence.replace(/.*FREQ=([A-Z]+).*/, '$1') : '';
		setRecurrenceFreq(freq);
	}

	async function handleSubmit(e: React.FormEvent): Promise<void> {
		e.preventDefault();
		if (submitting) return;
		setError(null);
		setErrorField(null);
		const validation = validateEventForm({ title, startsAt, endsAt, allDay });
		if (!validation.ok) {
			setError(validation.error);
			setErrorField(validation.field);
			focusEventField('event-create', validation.field);
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
			lastSeedDayRef.current = '';
			setActiveTemplate(null);
			setStartsAt('');
			setEndsAt('');
			setTitle('');
			setDescription('');
			setLocation('');
			setAllDay(false);
			setRecurrenceFreq('');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Termin konnte nicht gespeichert werden.');
			setErrorField(null);
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
				<DrawerHeader className="border-b pb-3">
					<DrawerTitle>Neuer Termin</DrawerTitle>
					<DrawerDescription className="sr-only">
						Für eure WG · Datum und Uhrzeit wie auf deinem Gerät.
					</DrawerDescription>
				</DrawerHeader>
				<form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-col">
					<div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
						<FieldSet disabled={submitting}>
							<FieldLegend variant="label">Vorlagen</FieldLegend>
							<div className="flex flex-wrap gap-2">
								{QUICK_TEMPLATES.map((template) => (
									<Button
										key={template.label}
										type="button"
										variant={activeTemplate === template.label ? 'secondary' : 'outline'}
										aria-pressed={activeTemplate === template.label}
										className="shrink-0"
										onClick={() => applyTemplate(template)}
										disabled={submitting}
									>
										{template.label}
									</Button>
								))}
							</div>
						</FieldSet>
						<EventFormFields
							idPrefix="event-create"
							title={title}
							onTitleChange={(value) => {
								setTitle(value);
								setActiveTemplate(null);
								clearErrorFor('title');
							}}
							startsAt={startsAt}
							onStartsAtChange={(value) => {
								setStartsAt(value);
								clearErrorFor('startsAt', 'endsAt');
							}}
							endsAt={endsAt}
							onEndsAtChange={(value) => {
								setEndsAt(value);
								clearErrorFor('startsAt', 'endsAt');
							}}
							allDay={allDay}
							onAllDayChange={(value) => {
								setAllDay(value);
								clearErrorFor('startsAt', 'endsAt');
							}}
							location={location}
							onLocationChange={setLocation}
							description={description}
							onDescriptionChange={setDescription}
							disabled={submitting}
							errorField={errorField}
							errorId="event-create-error"
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
							<Alert variant="destructive" id="event-create-error">
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						)}
					</div>
					<DrawerFooter className="border-t pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
						<Button type="submit" disabled={submitting} aria-label="Termin speichern">
							{submitting && <Spinner data-icon="inline-start" aria-hidden />}
							{submitting ? 'Speichert…' : 'Termin speichern'}
						</Button>
						<Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
							Abbrechen
						</Button>
					</DrawerFooter>
				</form>
			</DrawerContent>
		</Drawer>
	);
}
