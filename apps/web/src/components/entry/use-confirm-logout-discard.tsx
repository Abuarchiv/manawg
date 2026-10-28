import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';

/** `confirmDiscard` for `signOutSocialAccount`, resolved by the returned dialog. */
export function useConfirmLogoutDiscard() {
	const t = useTranslations('entry.discard');
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
			title={t('title')}
			description={t('description', { count: state.count })}
			confirmLabel={t('confirm')}
			variant="danger"
		/>
	);
	return { confirmDiscard, dialog };
}
