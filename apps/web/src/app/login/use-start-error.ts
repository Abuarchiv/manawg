'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StartField } from './start-flow';

const FIELD_INPUT_ID: Record<StartField, string> = {
	wgName: 'wg-name',
	creatorName: 'creator-name',
	inviteLink: 'invite-link',
};

/** The single error line of the start flow, optionally tied to the input it concerns. */
export function useStartError() {
	const [error, setError] = useState<string | null>(null);
	const [invalidField, setInvalidField] = useState<StartField | null>(null);
	// Counts field errors so a repeated identical error moves focus back to the field again.
	const [fieldErrorTick, setFieldErrorTick] = useState(0);

	const clearError = useCallback((): void => {
		setError(null);
		setInvalidField(null);
	}, []);

	const setFormError = useCallback((message: string): void => {
		setError(message);
		setInvalidField(null);
	}, []);

	const setFieldError = useCallback((field: StartField, message: string): void => {
		setError(message);
		setInvalidField(field);
		setFieldErrorTick((tick) => tick + 1);
	}, []);

	// Land on the first invalid field; focusing also scrolls it into view at large text sizes.
	useEffect(() => {
		if (fieldErrorTick === 0 || !invalidField) return;
		document.getElementById(FIELD_INPUT_ID[invalidField])?.focus();
	}, [fieldErrorTick, invalidField]);

	return { error, invalidField, clearError, setFormError, setFieldError };
}

export type StartErrorActions = Pick<
	ReturnType<typeof useStartError>,
	'clearError' | 'setFormError' | 'setFieldError'
>;
