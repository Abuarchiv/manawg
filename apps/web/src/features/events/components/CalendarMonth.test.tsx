import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CalendarMonth } from './CalendarMonth';

const occurrence = {
	eventId: 'evt-1',
	title: 'Heizungsablesung',
	description: null,
	startsAt: '2026-06-15T10:00:00.000Z',
	endsAt: null,
	allDay: false,
	location: null,
	recurring: false,
	occurrenceIndex: 0,
};

describe('CalendarMonth', () => {
	it('keeps event previews keyboard and click accessible', () => {
		const onSelectDay = vi.fn();
		const onSelectOccurrence = vi.fn();
		render(
			<CalendarMonth
				month={new Date(2026, 5, 1)}
				occurrences={[occurrence]}
				onPrev={vi.fn()}
				onNext={vi.fn()}
				onSelectDay={onSelectDay}
				onSelectOccurrence={onSelectOccurrence}
				selectedDay={null}
			/>,
		);

		const eventButton = screen.getByRole('button', { name: 'Termin öffnen: Heizungsablesung' });
		fireEvent.click(eventButton);
		expect(onSelectOccurrence).toHaveBeenCalledWith(occurrence);

		const day = screen.getByRole('gridcell', { name: /15.*Juni 2026/ });
		day.focus();
		fireEvent.keyDown(day, { key: 'Enter' });
		expect(onSelectDay).toHaveBeenCalled();
	});
});
