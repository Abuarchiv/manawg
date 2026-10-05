'use client';

import { type RefObject, useRef, useState } from 'react';

export interface BusyLock {
	// The ref blocks a second request before the busy state has re-rendered.
	busyRef: RefObject<boolean>;
	setBusy: (busy: boolean) => void;
}

/** One busy flag shared by every start-flow request (create, join, account switch). */
export function useBusyLock() {
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	return { busy, busyRef, setBusy };
}
