'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Switch } from '@/components/animate-ui/components/base/switch';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
	EVENT_DESCRIPTION_MAX,
	EVENT_LOCATION_MAX,
	EVENT_TITLE_MAX,
} from '@/features/events/event-limits';
import { normalizeEventDateTime } from '@/features/events/events';

interface EventFormFieldsProps {
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
	recurrenceField: ReactNode;
	disabled?: boolean;
	/** Field the current form error belongs to, if any (from `validateEventForm`). */
	errorField?: 'title' | 'startsAt' | 'endsAt' | null;
	/** id of the element rendering the error message, for `aria-describedby`. */
	errorId?: string;
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
	disabled = false,
	errorField = null,
	errorId,
}: EventFormFieldsProps) {
	const t = useTranslations('events.form');
	return (
		<FieldGroup className="gap-3">
			<Field data-disabled={disabled}>
				<FieldLabel htmlFor={`${idPrefix}-title`}>{t('title')}</FieldLabel>
				<Input
					id={`${idPrefix}-title`}
					value={title}
					onChange={(event) => onTitleChange(event.target.value)}
					maxLength={EVENT_TITLE_MAX}
					placeholder={t('titlePlaceholder')}
					required
					disabled={disabled}
					enterKeyHint="next"
					aria-invalid={errorField === 'title' ? true : undefined}
					aria-describedby={errorField === 'title' ? errorId : undefined}
					className="text-base"
				/>
			</Field>
			<Field
				orientation="horizontal"
				data-disabled={disabled}
				className="min-h-11 items-center justify-between"
			>
				<FieldLabel htmlFor={`${idPrefix}-all-day`}>{t('allDay')}</FieldLabel>
				<Switch
					id={`${idPrefix}-all-day`}
					checked={allDay}
					onCheckedChange={(checked) => {
						const nextAllDay = checked === true;
						onAllDayChange(nextAllDay);
						if (nextAllDay) {
							onStartsAtChange(normalizeEventDateTime(startsAt, true));
							onEndsAtChange(normalizeEventDateTime(endsAt, true));
						}
					}}
					disabled={disabled}
				/>
			</Field>
			<Field data-disabled={disabled} className="min-w-0">
				<FieldLabel htmlFor={`${idPrefix}-start`}>{t('starts')}</FieldLabel>
				<Input
					id={`${idPrefix}-start`}
					type={allDay ? 'date' : 'datetime-local'}
					value={allDay ? startsAt.slice(0, 10) : startsAt}
					onChange={(event) =>
						onStartsAtChange(
							allDay && event.target.value ? `${event.target.value}T00:00` : event.target.value,
						)
					}
					required
					disabled={disabled}
					aria-invalid={errorField === 'startsAt' ? true : undefined}
					aria-describedby={errorField === 'startsAt' ? errorId : undefined}
					className="min-w-0 text-base"
				/>
			</Field>
			<Field data-disabled={disabled} className="min-w-0">
				<FieldLabel htmlFor={`${idPrefix}-end`}>{t('ends')}</FieldLabel>
				<Input
					id={`${idPrefix}-end`}
					type={allDay ? 'date' : 'datetime-local'}
					value={allDay ? endsAt.slice(0, 10) : endsAt}
					onChange={(event) =>
						onEndsAtChange(
							allDay && event.target.value ? `${event.target.value}T00:00` : event.target.value,
						)
					}
					disabled={disabled}
					aria-invalid={errorField === 'endsAt' ? true : undefined}
					aria-describedby={errorField === 'endsAt' ? errorId : undefined}
					// WebKit paints the current time in full text color inside empty date fields; muting it keeps it from looking like a value.
					data-empty={endsAt ? undefined : ''}
					className="min-w-0 text-base data-[empty]:text-muted-foreground"
				/>
			</Field>
			<Field data-disabled={disabled}>
				<FieldLabel htmlFor={`${idPrefix}-location`}>{t('location')}</FieldLabel>
				<Input
					id={`${idPrefix}-location`}
					value={location}
					onChange={(event) => onLocationChange(event.target.value)}
					maxLength={EVENT_LOCATION_MAX}
					placeholder={t('locationPlaceholder')}
					disabled={disabled}
					enterKeyHint="next"
					className="text-base"
				/>
			</Field>
			{recurrenceField}
			<Field data-disabled={disabled}>
				<FieldLabel htmlFor={`${idPrefix}-description`}>{t('note')}</FieldLabel>
				<Textarea
					id={`${idPrefix}-description`}
					value={description}
					onChange={(event) => onDescriptionChange(event.target.value)}
					maxLength={EVENT_DESCRIPTION_MAX}
					rows={3}
					disabled={disabled}
					className="text-base"
				/>
			</Field>
		</FieldGroup>
	);
}

const FIELD_ID_SUFFIX = { title: 'title', startsAt: 'start', endsAt: 'end' } as const;

/**
 * Focus the invalid field, then scroll it into view once the pinned form error has rendered
 * and shrunk the scroll area.
 */
export function focusEventField(idPrefix: string, field: keyof typeof FIELD_ID_SUFFIX): void {
	const el = document.getElementById(`${idPrefix}-${FIELD_ID_SUFFIX[field]}`);
	el?.focus();
	requestAnimationFrame(() => el?.scrollIntoView({ block: 'nearest' }));
}
