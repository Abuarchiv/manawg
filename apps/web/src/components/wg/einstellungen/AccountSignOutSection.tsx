'use client';

import { LogOut, MonitorOff } from 'lucide-react';
import { useState } from 'react';
import { rememberLogoutNotice } from '@/components/entry/LogoutNotice';
import { useConfirmLogoutDiscard } from '@/components/entry/use-confirm-logout-discard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { WgSummary } from '@/components/wg/WgContextProvider';
import type { SessionMember } from '@/core/auth/local-account';

export function AccountSignOutSection({
	wg,
	identity,
}: {
	wg: WgSummary;
	identity: SessionMember;
}) {
	const { confirmDiscard, dialog } = useConfirmLogoutDiscard();
	const [accountSignOutPending, setAccountSignOutPending] = useState<'here' | 'everywhere' | null>(
		null,
	);
	const [accountSignOutError, setAccountSignOutError] = useState<string | null>(null);

	async function handleAccountSignOut(everywhere: boolean): Promise<void> {
		if (accountSignOutPending) return;
		setAccountSignOutPending(everywhere ? 'everywhere' : 'here');
		setAccountSignOutError(null);
		try {
			const { signOutSocialAccount } = await import('@/core/auth/client');
			const { pushCleanup, cancelled } = await signOutSocialAccount(
				[
					{
						code: wg.shareCode,
						memberId: identity.memberId,
					},
				],
				{ confirmDiscard, everywhere },
			);
			if (cancelled) return;
			// Local data is gone, so the visitor leaves the household screen either way; a failed
			// push cleanup is told on the page they land on.
			if (pushCleanup === 'failed') {
				rememberLogoutNotice(
					'Du bist abgemeldet, aber Push konnte auf diesem Browser nicht sicher beendet werden. Deaktiviere Website-Benachrichtigungen in den Browsereinstellungen.',
				);
			}
			// A full load, not router.push: the client router cache (staleTimes 300 s) and in-memory
			// state still hold this account's WG pages for whoever uses the browser next.
			window.location.assign('/');
		} catch {
			setAccountSignOutError('Konto konnte nicht abgemeldet werden. Bitte versuche es erneut.');
		} finally {
			setAccountSignOutPending(null);
		}
	}

	return (
		<div className="flex flex-col gap-2">
			<Button
				type="button"
				variant="outline"
				onClick={() => void handleAccountSignOut(false)}
				disabled={accountSignOutPending !== null}
				aria-label="Konto abmelden"
				className="w-full"
			>
				{accountSignOutPending === 'here' ? <Spinner aria-hidden /> : <LogOut aria-hidden />}
				{accountSignOutPending === 'here' ? 'Meldet ab…' : 'Konto abmelden'}
			</Button>
			<Button
				type="button"
				variant="ghost"
				onClick={() => void handleAccountSignOut(true)}
				disabled={accountSignOutPending !== null}
				className="w-full text-muted-foreground"
			>
				{accountSignOutPending === 'everywhere' ? (
					<Spinner aria-hidden />
				) : (
					<MonitorOff aria-hidden />
				)}
				{accountSignOutPending === 'everywhere' ? 'Meldet ab…' : 'Auf allen Geräten abmelden'}
			</Button>
			{accountSignOutError && (
				<Alert variant="destructive">
					<AlertDescription>{accountSignOutError}</AlertDescription>
				</Alert>
			)}
			{dialog}
		</div>
	);
}
