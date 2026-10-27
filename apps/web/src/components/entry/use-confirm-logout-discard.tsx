import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useCallback, useRef, useState } from 'react';

/** `confirmDiscard` for `signOutSocialAccount`, resolved by the returned dialog. */
export function useConfirmLogoutDiscard() {
	const [state, setState] = useState({ open: false, count: 0 });
	const resolver = useRef<((discard: boolean) => void) | null>(null);
	const confirmDiscard = useCallback(
		(count: number) =>
			new Promise<boolean>((resolve) => {
				resolver.current = resolve;
				setState({ open: true, count });
			}),
		[],
	);
	const settle = (discard: boolean) => {
		resolver.current?.(discard);
		resolver.current = null;
		setState((s) => ({ ...s, open: false }));
	};
	const dialog = (
		<ConfirmDialog
			open={state.open}
			onClose={() => settle(false)}
			onConfirm={() => settle(true)}
			title="Ungesendete Aktionen"
			description={
				state.count === 1
					? '1 ungesendete Aktion geht beim Abmelden verloren.'
					: `${state.count} ungesendete Aktionen gehen beim Abmelden verloren.`
			}
			confirmLabel="Trotzdem abmelden"
			variant="danger"
		/>
	);
	return { confirmDiscard, dialog };
}
