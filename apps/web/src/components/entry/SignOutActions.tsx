'use client';

import { ErrorBox } from '@/components/app/ErrorBox';
import { useConfirmLogoutDiscard } from '@/components/entry/useConfirmLogoutDiscard';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AccountDeleteSection } from '@/components/wg/einstellungen/AccountDeleteSection';
import { LogOut } from 'lucide-react';
import { useState } from 'react';

// Signed-in users without a WG never reach WG settings, so offer sign-out and deletion here.
export function SignOutActions({ onSignedOut }: { onSignedOut: () => void }) {
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
					{signingOut ? 'Meldet ab…' : 'Mit anderem Konto anmelden'}
				</Button>
				{signOutError && (
					<ErrorBox>Konto konnte nicht abgemeldet werden. Bitte versuche es erneut.</ErrorBox>
				)}
			</div>
			<AccountDeleteSection />
			{dialog}
		</div>
	);
}
