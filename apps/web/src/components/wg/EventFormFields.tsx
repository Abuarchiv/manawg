'use client';

import { FIELD_INPUT } from '@/components/ui/styles';
import type { ReactNode } from 'react';

/**
 * The date/time, all-day, location and note fields shared by the event create
 * and edit modals. Both carried a byte-identical copy of this markup.
 *
 * Recurrence stays with each modal: creating offers a preset select, editing
 * exposes the raw RRULE. Everything else is the same form.
 */

/**
 * The create modal capped these; the edit modal capped nothing, so editing an
 * event could send a title the API then rejected. Sharing the fields gives
 * both the same caps.
 */
const TITLE_MAX = 200;
const LOCATION_MAX = 200;
const DESCRIPTION_MAX = 2_000;

const LABEL = 'mb-1.5 block text-[13px] font-medium text-[var(--text-1)]';

interface EventFormFieldsProps {
	/** Prefixes every field id so the two modals can coexist in one tree. */
	idPrefix: string;
	title: string;
	onTitleChange: (value: string) => void;
	startsAt: string;
	onStartsAtChange: (value: string) => void;
	endsAt: string;
	onEndsAtChange: (value: string) => void;
	allDay: boolean;
	onAllDayChange: (value: boolean) => void;
	location: string;
	onLocationChange: (value: string) => void;
	description: string;
	onDescriptionChange: (value: string) => void;
	/**
	 * Rendered between location and note. Creating offers a preset select,
	 * editing exposes the raw RRULE, so each modal supplies its own.
	 */
	recurrenceField: ReactNode;
}

export function EventFormFields({
	idPrefix,
	title,
	onTitleChange,
	startsAt,
	onStartsAtChange,
	endsAt,
	onEndsAtChange,
	allDay,
	onAllDayChange,
	location,
	onLocationChange,
	description,
	onDescriptionChange,
	recurrenceField,
}: EventFormFieldsProps) {
	return (
		<>
			<div>
				<label htmlFor={`${idPrefix}-title`} className={LABEL}>
					Titel
				</label>
				<input
					id={`${idPrefix}-title`}
					type="text"
					value={title}
					onChange={(e) => onTitleChange(e.target.value)}
					maxLength={TITLE_MAX}
					placeholder="z. B. Heizungsablesung"
					className={`${FIELD_INPUT} text-[var(--text-1)]`}
				/>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<div>
					<label htmlFor={`${idPrefix}-start`} className={LABEL}>
						Beginn
					</label>
					<input
						id={`${idPrefix}-start`}
						type={allDay ? 'date' : 'datetime-local'}
						value={allDay ? startsAt.slice(0, 10) : startsAt}
						onChange={(e) => onStartsAtChange(allDay ? `${e.target.value}T00:00` : e.target.value)}
						className={FIELD_INPUT}
					/>
				</div>
				<div>
					<label htmlFor={`${idPrefix}-end`} className={LABEL}>
						Ende (optional)
					</label>
					<input
						id={`${idPrefix}-end`}
						type={allDay ? 'date' : 'datetime-local'}
						value={endsAt}
						onChange={(e) => onEndsAtChange(e.target.value)}
						className={FIELD_INPUT}
					/>
				</div>
			</div>
			<label className="flex items-center gap-2 text-[13px] text-[var(--text-1)]">
				<input
					type="checkbox"
					checked={allDay}
					onChange={(e) => onAllDayChange(e.target.checked)}
					className="h-5 w-5 rounded border-[var(--border)] accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				/>
				Ganztägig
			</label>
			<div>
				<label htmlFor={`${idPrefix}-location`} className={LABEL}>
					Ort (optional)
				</label>
				<input
					id={`${idPrefix}-location`}
					type="text"
					value={location}
					onChange={(e) => onLocationChange(e.target.value)}
					maxLength={LOCATION_MAX}
					placeholder="z. B. Küche"
					className={FIELD_INPUT}
				/>
			</div>
			{recurrenceField}
			<div>
				<label htmlFor={`${idPrefix}-description`} className={LABEL}>
					Notiz (optional)
				</label>
				<textarea
					id={`${idPrefix}-description`}
					value={description}
					onChange={(e) => onDescriptionChange(e.target.value)}
					maxLength={DESCRIPTION_MAX}
					rows={3}
					className="block w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-base outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				/>
			</div>
		</>
	);
}
