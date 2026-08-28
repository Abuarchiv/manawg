'use client';

import { ALERT_DANGER, FIELD_INPUT, ICON_BUTTON } from '@/components/ui/styles';
import { EventFormFields } from '@/components/wg/EventFormFields';
import { validateEventForm } from '@/lib/wg/events';
import { useFocusTrap } from '@manawg/shared/lib/hooks/useFocusTrap';
import { Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface EditableEvent {
	id: string;
	title: string;
	description: string | null;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	location: string | null;
	recurrence: string | null;
}

export interface UpdateEventPayload {
	title: string;
	description: string | null;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	location: string | null;
	recurrence: string | null;
}

interface EventEditModalProps {
	event: EditableEvent | null;
	onClose: () => void;
	onUpdate: (id: string, payload: UpdateEventPayload) => Promise<void>;
	onDelete: (id: string) => Promise<void>;
}

function toLocalInputValue(iso: string): string {
	const d = new Date(iso);
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventEditModal({ event, onClose, onUpdate, onDelete }: EventEditModalProps) {
	const trapRef = useFocusTrap<HTMLDivElement>(event !== null);
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [startsAt, setStartsAt] = useState('');
	const [endsAt, setEndsAt] = useState('');
	const [allDay, setAllDay] = useState(false);
	const [location, setLocation] = useState('');
	const [recurrence, setRecurrence] = useState('');
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!event) return;
		setTitle(event.title);
		setDescription(event.description ?? '');
		setStartsAt(toLocalInputValue(event.startsAt));
		setEndsAt(event.endsAt ? toLocalInputValue(event.endsAt) : '');
		setAllDay(event.allDay);
		setLocation(event.location ?? '');
		setRecurrence(event.recurrence ?? '');
		setError(null);
	}, [event]);

	useEffect(() => {
		if (!event) return;
		const handleKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handleKey);
		return () => document.removeEventListener('keydown', handleKey);
	}, [event, onClose]);

	if (!event) return null;

	async function handleSave(e: React.FormEvent): Promise<void> {
		e.preventDefault();
		setError(null);
		if (!event) return;
		const validation = validateEventForm({ title, startsAt, endsAt });
		if (!validation.ok) {
			setError(validation.error);
			return;
		}
		const trimmedTitle = title.trim();
		const startDate = validation.startsAt;
		const endDate = validation.endsAt;
		setSaving(true);
		try {
			await onUpdate(event.id, {
				title: trimmedTitle,
				description: description.trim() || null,
				startsAt: startDate.toISOString(),
				endsAt: endDate ? endDate.toISOString() : null,
				allDay,
				location: location.trim() || null,
				recurrence: recurrence.trim() || null,
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete(): Promise<void> {
		if (!event) return;
		setDeleting(true);
		try {
			await onDelete(event.id);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
		} finally {
			setDeleting(false);
		}
	}

	return (
		<div
			ref={trapRef}
			// biome-ignore lint/a11y/useSemanticElements: native <dialog> UA display:none kills CSS transitions (see native-dialog-css-transition-kill skill)
			role="dialog"
			aria-modal="true"
			aria-labelledby="event-edit-title"
			className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
		>
			<form
				onSubmit={handleSave}
				className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--bg-base)] p-5 shadow-xl sm:rounded-2xl"
				style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
			>
				<span className="sheet-handle" aria-hidden />
				<div className="flex items-center justify-between">
					<h2 id="event-edit-title" className="text-base font-semibold text-[var(--text-1)]">
						Termin bearbeiten
					</h2>
					<button type="button" onClick={onClose} aria-label="Schließen" className={ICON_BUTTON}>
						<X className="h-4 w-4" aria-hidden />
					</button>
				</div>
				<EventFormFields
					idPrefix="event-edit"
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
								htmlFor="event-edit-recurrence"
								className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
							>
								Wiederholung
							</label>
							<input
								id="event-edit-recurrence"
								type="text"
								value={recurrence}
								onChange={(e) => setRecurrence(e.target.value)}
								placeholder="z. B. FREQ=WEEKLY oder leer für einmalig"
								className={FIELD_INPUT}
							/>
						</div>
					}
				/>
				{error && (
					<div role="alert" className={ALERT_DANGER}>
						{error}
					</div>
				)}
				<div className="flex flex-wrap items-center justify-between gap-2">
					<button
						type="button"
						onClick={() => void handleDelete()}
						disabled={deleting}
						aria-label="Termin löschen"
						className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--danger)]/30 px-4 text-[13px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						{deleting ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
						) : (
							<Trash2 className="h-3.5 w-3.5" aria-hidden />
						)}
						Löschen
					</button>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={onClose}
							className="inline-flex h-11 items-center rounded-xl border border-[var(--border)] px-4 text-[13px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							Abbrechen
						</button>
						<button
							type="submit"
							disabled={saving}
							className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--text-1)] px-4 text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
						>
							{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
							Speichern
						</button>
					</div>
				</div>
			</form>
		</div>
	);
}
