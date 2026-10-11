interface QueuedToast {
	variant: 'success' | 'error' | 'info';
}

/**
 * Append `toast` and, beyond `max`, drop the oldest non-error toast (the incoming one included),
 * so an unread error is only displaced when every toast in the stack is an error.
 */
export function pushToast<T extends QueuedToast>(list: readonly T[], toast: T, max: number): T[] {
	const next = [...list, toast];
	while (next.length > max) {
		const index = next.findIndex((t) => t.variant !== 'error');
		next.splice(index === -1 ? 0 : index, 1);
	}
	return next;
}
