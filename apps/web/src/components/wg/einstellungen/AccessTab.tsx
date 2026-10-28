'use client';

import { SocialLoginButtons, type SocialProvider } from '@/components/auth/SocialLoginButtons';
import type { Member, WgSummary } from '@/components/wg/WgContextProvider';
import { AccountSignOutSection } from '@/components/wg/einstellungen/AccountSignOutSection';
import { AccountWgsSection } from '@/components/wg/einstellungen/AccountWgsSection';
import { DangerZoneSection } from '@/components/wg/einstellungen/DangerZoneSection';
import { EmailChangeRow } from '@/components/wg/einstellungen/EmailChangeRow';
import { InvitesSection } from '@/components/wg/einstellungen/InvitesSection';
import { MembersSection } from '@/components/wg/einstellungen/MembersSection';
import { PasswordChangeRow } from '@/components/wg/einstellungen/PasswordChangeRow';
import { Section } from '@/components/wg/einstellungen/Section';
import type { SessionMember } from '@/core/auth/local-account';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

interface AccessTabProps {
	wg: WgSummary;
	members: Member[];
	identity: SessionMember;
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
			// Without an answer the button stays visible; a failure while linking is explained there.
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);
	return linked;
}

/** The account e-mail for password accounts; null for others and while unknown. */
function usePasswordAccountEmail(): string | null {
	const [email, setEmail] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		import('@/core/auth/client')
			.then(({ getEmailAccount }) => getEmailAccount())
			.then((account) => {
				if (active && account?.hasPassword) setEmail(account.email);
			})
			// Without an answer the rows stay hidden; sign-in and reset remain available.
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);
	return email;
}

export function AccessTab({ wg, members, identity }: AccessTabProps) {
	const t = useTranslations('settings.accessTab');
	const googleLinked = useGoogleLinked();
	const accountEmail = usePasswordAccountEmail();
	const settingsReturnPath = `/wg/${encodeURIComponent(wg.shareCode)}/einstellungen#zugang`;

	return (
		<>
			<InvitesSection wg={wg} identity={identity} />
			<Section title={t('signInMethods')}>
				<div className="flex flex-col gap-3 p-3">
					<PasswordChangeRow email={accountEmail} />
					<EmailChangeRow current={accountEmail} returnPath={settingsReturnPath} />
					{googleLinked ? (
						<p className="text-sm text-muted-foreground">{t('googleLinked')}</p>
					) : (
						<SocialLoginButtons
							variant="link"
							next={settingsReturnPath}
							onOAuthStart={linkSocialIdentity}
						/>
					)}
				</div>
			</Section>

			<AccountWgsSection currentCode={wg.shareCode} />
			<MembersSection wg={wg} members={members} identity={identity} />
			<Section title={t('account')}>
				<div className="p-3">
					<AccountSignOutSection wg={wg} identity={identity} />
				</div>
			</Section>
			<DangerZoneSection wg={wg} members={members} identity={identity} />
		</>
	);
}
