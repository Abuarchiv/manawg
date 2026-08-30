'use client';

import { ALERT_DANGER, FIELD_INPUT, ICON_BUTTON } from '@/components/ui/styles';
import { EventFormFields } from '@/features/events/components/EventFormFields';
import {
	type RecurrenceFreq,
	formatRecurrenceRule,
	validateEventForm,
} from '@/features/events/events';
import { useFocusTrap } from '@/shared/lib/hooks/useFocusTrap';
import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

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

const RECURRENCE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: '', label: 'Einmalig' },
	{ value: 'DAILY', label: 'Täglich' },
	{ value: 'WEEKLY', label: 'Wöchentlich' },
	{ value: 'MONTHLY', label: 'Monatlich' },
	{ value: 'YEARLY', label: 'Jährlich' },
];

function buildIsoLocal(date: Date): string {
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
		date.getHours(),
	)}:${pad(date.getMinutes())}`;
}

export function EventCreateModal({ open, onClose, onSubmit, defaultDate }: EventCreateModalProps) {
	const trapRef = useFocusTrap<HTMLDivElement>(open);
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [startsAt, setStartsAt] = useState('');
	const [endsAt, setEndsAt] = useState('');
	const [allDay, setAllDay] = useState(false);
	const [location, setLocation] = useState('');
	const [recurrenceFreq, setRecurrenceFreq] = useState<string>('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setError(null);
		const seed = defaultDate ?? new Date();
		const seeded = new Date(seed);
		seeded.setMinutes(0, 0, 0);
		setStartsAt(buildIsoLocal(seeded));
		setEndsAt('');
	}, [open, defaultDate]);

	useEffect(() => {
		if (!open) return;
		const handleKey = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handleKey);
		return () => document.removeEventListener('keydown', handleKey);
	}, [open, onClose]);

	function applyTemplate(template: (typeof QUICK_TEMPLATES)[number]): void {
		setTitle(template.title);
		setAllDay(template.allDay);
		const freq = template.recurrence ? template.recurrence.replace(/.*FREQ=([A-Z]+).*/, '$1') : '';
		setRecurrenceFreq(freq);
	}

	async function handleSubmit(e: React.FormEvent): Promise<void> {
		e.preventDefault();
		setError(null);
		const validation = validateEventForm({ title, startsAt, endsAt });
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

	if (!open) return null;

	return (
		<div
			ref={trapRef}
			// biome-ignore lint/a11y/useSemanticElements: native <dialog> UA display:none kills CSS transitions (see native-dialog-css-transition-kill skill)
			role="dialog"
			aria-modal="true"
			aria-labelledby="event-create-heading"
			className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
		>
			<form
				onSubmit={handleSubmit}
				className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--bg-base)] p-5 shadow-xl sm:rounded-2xl"
				style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
			>
				<span className="sheet-handle" aria-hidden />
				<div className="flex items-center justify-between">
					<h2 id="event-create-heading" className="text-base font-semibold text-[var(--text-1)]">
						Neuer Termin
					</h2>
					<button type="button" onClick={onClose} aria-label="Schließen" className={ICON_BUTTON}>
						<X className="h-4 w-4" aria-hidden />
					</button>
				</div>
				<fieldset className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
					<legend className="sr-only">Schnellvorlagen</legend>
					{QUICK_TEMPLATES.map((tpl) => (
						<button
							key={tpl.label}
							type="button"
							onClick={() => applyTemplate(tpl)}
							className="inline-flex h-11 items-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							{tpl.label}
						</button>
					))}
				</fieldset>
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
					recurrenceField={
						<div>
							<label
								htmlFor="event-recurrence"
								className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
							>
								Wiederholung
							</label>
							<select
								id="event-recurrence"
								value={recurrenceFreq}
								onChange={(e) => setRecurrenceFreq(e.target.value)}
								className={FIELD_INPUT}
							>
								{RECURRENCE_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
						</div>
					}
				/>
				{error && (
					<div role="alert" className={ALERT_DANGER}>
						{error}
					</div>
				)}
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="inline-flex h-11 items-center rounded-xl border border-[var(--border)] px-4 text-[13px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						Abbrechen
					</button>
					<button
						type="submit"
						disabled={submitting}
						aria-label="Termin speichern"
						className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--text-1)] px-4 text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						{submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
						Speichern
					</button>
				</div>
			</form>
		</div>
	);
}
