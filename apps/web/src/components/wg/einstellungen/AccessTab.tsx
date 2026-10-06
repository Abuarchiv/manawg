'use client';

import { SocialLoginButtons, type SocialProvider } from '@/components/auth/SocialLoginButtons';
import type { Member, WgSummary } from '@/components/wg/WgContextProvider';
import { AccountDeleteSection } from '@/components/wg/einstellungen/AccountDeleteSection';
import { AccountSignOutSection } from '@/components/wg/einstellungen/AccountSignOutSection';
import { DangerZoneSection } from '@/components/wg/einstellungen/DangerZoneSection';
import { MembersSection } from '@/components/wg/einstellungen/MembersSection';
import { Section } from '@/components/wg/einstellungen/Section';
import { ShareAccessSection } from '@/components/wg/einstellungen/ShareAccessSection';
import type { StoredIdentity } from '@/shared/lib/identity';
import { useEffect, useState } from 'react';

interface AccessTabProps {
	wg: WgSummary;
	members: Member[];
	identity: StoredIdentity;
}

async function linkSocialIdentity(provider: SocialProvider, next: string): Promise<void> {
	const { linkSocialIdentity } = await import('@/core/auth/client');
	await linkSocialIdentity(provider, next);
}

function useGoogleLinked(): boolean {
	const [linked, setLinked] = useState(false);
	useEffect(() => {
		let active = true;
		import('@/core/auth/client')
			.then(({ hasLinkedIdentity }) => hasLinkedIdentity('google'))
			.then((value) => {
				if (active) setLinked(value);
			})
			// Without an answer the button stays visible; a failed link is explained there.
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);
	return linked;
}

export function AccessTab({ wg, members, identity }: AccessTabProps) {
	const [joiningEnabled, setJoiningEnabled] = useState(wg.joiningEnabled);
	const googleLinked = useGoogleLinked();

	useEffect(() => {
		setJoiningEnabled(wg.joiningEnabled);
	}, [wg.joiningEnabled]);

	return (
		<>
			<ShareAccessSection
				wg={wg}
				identity={identity}
				joiningEnabled={joiningEnabled}
				onJoiningEnabledChange={setJoiningEnabled}
			/>
			<Section title="Anmeldemethoden">
				<div className="p-3">
					{googleLinked ? (
						<p className="text-sm text-muted-foreground">Google ist mit deinem Konto verknüpft.</p>
					) : (
						<SocialLoginButtons
							variant="link"
							next={`/wg/${encodeURIComponent(wg.shareCode)}/einstellungen#zugang`}
							onOAuthStart={linkSocialIdentity}
						/>
					)}
				</div>
			</Section>

			<MembersSection wg={wg} members={members} identity={identity} />
			<Section title="Konto">
				<div className="grid gap-3 p-3">
					<AccountSignOutSection wg={wg} identity={identity} />
					<AccountDeleteSection embedded />
				</div>
			</Section>
			<DangerZoneSection wg={wg} members={members} identity={identity} />
		</>
	);
}
