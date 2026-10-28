'use client';

import { useEffect, useState } from 'react';
import { subscribeVisibility } from '@/core/hooks/use-online-status';
import { msUntilNextLocalDay, todayInputValue } from '@/core/utils/local-date';

/**
 * Today's date as an `<input type="date">` value. Rolls over at midnight, also in a tab that
 * stays in front, and when a tab left open past midnight returns.
 */
export function useTodayInputValue(): string {
	const [today, setToday] = useState(() => todayInputValue());
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const refresh = () => {
			setToday(todayInputValue());
			clearTimeout(timer);
			timer = setTimeout(refresh, msUntilNextLocalDay());
		};
		refresh();
		window.addEventListener('focus', refresh);
		const unsubscribeVisibility = subscribeVisibility(refresh);
		return () => {
			clearTimeout(timer);
			window.removeEventListener('focus', refresh);
			unsubscribeVisibility();
		};
	}, []);
	return today;
}
