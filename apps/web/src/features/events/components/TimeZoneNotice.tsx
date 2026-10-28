'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

const WG_TIME_ZONE = 'Europe/Berlin';

/**
 * Times are shown and entered in the device's time zone, while repeats and reminders follow
 * Berlin time. A device elsewhere sees the difference named instead of finding it in a time.
 */
export function TimeZoneNotice() {
	const t = useTranslations('events.page');
	const [zone, setZone] = useState<string | null>(null);
	useEffect(() => {
		try {
			const device = new Intl.DateTimeFormat().resolvedOptions().timeZone;
			setZone(device && device !== WG_TIME_ZONE ? device : null);
		} catch {
			setZone(null);
		}
	}, []);
	if (!zone) return null;
	return (
		<Alert>
			<AlertDescription>{t('timeZoneNotice', { zone })}</AlertDescription>
		</Alert>
	);
}
