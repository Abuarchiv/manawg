'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { WgSummary } from '@/components/wg/WgContextProvider';
import { Section } from '@/components/wg/einstellungen/Section';
import type { StoredIdentity } from '@/shared/lib/identity';
import { clearIdentity, forgetWg } from '@/shared/lib/identity';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AccountSignOutSection({
	wg,
	identity,
}: {
	wg: WgSummary;
	identity: StoredIdentity;
}) {
	const router = useRouter();
	const [accountSignOutPending, setAccountSignOutPending] = useState(false);
	const [accountSignOutError, setAccountSignOutError] = useState<string | null>(null);

	async function handleAccountSignOut(): Promise<void> {
		if (accountSignOutPending) return;
		setAccountSignOutPending(true);
		setAccountSignOutError(null);
		try {
			const { signOutSocialAccount } = await import('@/core/auth/client');
			const { pushCleanup } = await signOutSocialAccount([
				{
					code: wg.shareCode,
					memberId: identity.memberId,
					...(identity.memberToken ? { memberToken: identity.memberToken } : {}),
				},
			]);
			clearIdentity(wg.id);
			forgetWg(wg.shareCode);
			if (pushCleanup === 'failed') {
				window.alert(
					'Du bist abgemeldet, aber Push konnte auf diesem Browser nicht sicher beendet werden. Deaktiviere Website-Benachrichtigungen in den Browsereinstellungen.',
				);
			}
			router.push('/');
		} catch {
			setAccountSignOutError('Konto konnte nicht abgemeldet werden. Bitte versuche es erneut.');
		} finally {
			setAccountSignOutPending(false);
		}
	}

	return (
		<Section title="Konto abmelden">
			<div className="p-3">
				<Button
					type="button"
					variant="outline"
					onClick={() => void handleAccountSignOut()}
					disabled={accountSignOutPending}
					aria-label="Konto abmelden"
					className="w-full"
				>
					{accountSignOutPending ? <Spinner aria-hidden /> : <LogOut aria-hidden />}
					{accountSignOutPending ? 'Meldet ab…' : 'Konto abmelden'}
				</Button>
				{accountSignOutError && (
					<Alert variant="destructive" className="mt-2">
						<AlertDescription>{accountSignOutError}</AlertDescription>
					</Alert>
				)}
			</div>
		</Section>
	);
}
