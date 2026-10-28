'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorBox } from '@/components/app/ErrorBox';
import { useConfirmLogoutDiscard } from '@/components/entry/use-confirm-logout-discard';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AccountDeleteSection } from '@/components/wg/einstellungen/AccountDeleteSection';

// Signed-in users without a WG never reach WG settings, so offer sign-out and deletion here.
export function SignOutActions({ onSignedOut }: { onSignedOut: () => void }) {
	const t = useTranslations('entry.signOut');
	const { confirmDiscard, dialog } = useConfirmLogoutDiscard();
	const [signingOut, setSigningOut] = useState(false);
	const [signOutError, setSignOutError] = useState(false);

	// Wrong Google account on a WG-less home: end the session instead of forcing deletion.
	async function signOut(): Promise<void> {
		if (signingOut) return;
		setSigningOut(true);
		setSignOutError(false);
		try {
			const { signOutSocialAccount } = await import('@/core/auth/client');
			const { cancelled } = await signOutSocialAccount([], { confirmDiscard });
			if (!cancelled) onSignedOut();
		} catch {
			setSignOutError(true);
		} finally {
			setSigningOut(false);
		}
	}

	return (
		<div className="mt-4 flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<Button
					type="button"
					variant="outline"
					onClick={() => void signOut()}
					disabled={signingOut}
					className="w-full"
				>
					{signingOut ? <Spinner data-icon="inline-start" aria-hidden /> : <LogOut aria-hidden />}
					{signingOut ? t('signingOut') : t('switch')}
				</Button>
				{signOutError && <ErrorBox>{t('failed')}</ErrorBox>}
			</div>
			<AccountDeleteSection />
			{dialog}
		</div>
	);
}
