'use client';

import { useCallback, useState } from 'react';
import type { StartField } from './start-flow';

/** The single error line of the start flow, optionally tied to the input it concerns. */
export function useStartError() {
	const [error, setError] = useState<string | null>(null);
	const [invalidField, setInvalidField] = useState<StartField | null>(null);

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
	}, []);

	return { error, invalidField, clearError, setFormError, setFieldError };
}

export type StartErrorActions = Pick<
	ReturnType<typeof useStartError>,
	'clearError' | 'setFormError' | 'setFieldError'
>;
