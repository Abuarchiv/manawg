'use client';

import { SocialLoginButtons, type SocialProvider } from '@/components/auth/SocialLoginButtons';
import type { Member, WgSummary } from '@/components/wg/WgContextProvider';
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

export function AccessTab({ wg, members, identity }: AccessTabProps) {
	const [joiningEnabled, setJoiningEnabled] = useState(wg.joiningEnabled);

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
			<Section
				title="Anmeldemethoden"
				hint="Verknüpfe einen weiteren Anbieter, damit dein Zugang auch bei Gerätewechsel erhalten bleibt."
			>
				<div className="p-3">
					<SocialLoginButtons
						variant="link"
						next={`/wg/${encodeURIComponent(wg.shareCode)}/einstellungen#zugang`}
						onOAuthStart={linkSocialIdentity}
					/>
				</div>
			</Section>

			<MembersSection
				wg={wg}
				members={members}
				identity={identity}
				joiningEnabled={joiningEnabled}
			/>
			<AccountSignOutSection wg={wg} identity={identity} />
			<DangerZoneSection wg={wg} members={members} identity={identity} />
		</>
	);
}
