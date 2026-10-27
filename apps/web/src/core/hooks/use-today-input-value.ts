'use client';

import { subscribeVisibility } from '@/core/hooks/use-online-status';
import { todayInputValue } from '@/core/utils/local-date';
import { useEffect, useState } from 'react';

/** Today's date as an `<input type="date">` value; rolls over when a tab left open past midnight returns. */
export function useTodayInputValue(): string {
	const [today, setToday] = useState(() => todayInputValue());
	useEffect(() => {
		const refresh = () => setToday(todayInputValue());
		window.addEventListener('focus', refresh);
		const unsubscribeVisibility = subscribeVisibility(refresh);
		return () => {
			window.removeEventListener('focus', refresh);
			unsubscribeVisibility();
		};
	}, []);
	return today;
}
