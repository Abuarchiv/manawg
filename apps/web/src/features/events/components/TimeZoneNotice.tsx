'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { useEffect, useState } from 'react';

const WG_TIME_ZONE = 'Europe/Berlin';

/**
 * Times are shown and entered in the device's time zone, while repeats and reminders follow
 * Berlin time. A device elsewhere sees the difference named instead of finding it in a time.
 */
export function TimeZoneNotice() {
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
			<AlertDescription>
				Dieses Gerät nutzt die Zeitzone {zone}. Uhrzeiten erscheinen in dieser Zeit, Wiederholungen
				und Erinnerungen folgen der Berliner Zeit.
			</AlertDescription>
		</Alert>
	);
}
