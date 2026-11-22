import 'server-only';
import type { Metadata } from 'next';
import { findInvitePreview } from '@/core/db/invite-preview';
import { serverT } from '@/core/i18n/server-t';
import { logApiError } from '@/core/infra/observability';
import type { InvitePreview } from '@/core/utils/invite-token';
import { fixtureInvitePreview } from '@/fixtures/invites';
import { DEFAULT_LOCALE, isLocale } from '@/shared/i18n/locale';
import { ogBase, TWITTER_BASE } from '@/shared/lib/og';

async function lookup(token: string): Promise<InvitePreview | null> {
	const fixture = fixtureInvitePreview(token);
	if (fixture !== undefined) return fixture;
	try {
		return await findInvitePreview(token);
	} catch (err) {
		logApiError('[invite metadata] preview lookup failed', err);
		return null;
	}
}

/**
 * Metadata of the invitation page. Invite links are mostly shared in chats, and link-preview
 * crawlers run no JavaScript, so a usable invitation is named here the way the page heading names
 * it: who invites to which flat, in the title and the description, plus the member count once
 * the flat has two. Any token that cannot be used, and any lookup error, keeps the generic
 * invitation card. The token itself never goes into the metadata. The lookup is the read-only one behind the preview endpoint, without its
 * per-IP budget: messenger crawlers fetch from a handful of addresses, and a guessed token
 * (128 bits) only ever finds the generic card.
 */
export async function inviteMetadata(token: string, requestLocale: string): Promise<Metadata> {
	const locale = isLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE;
	const meta = serverT(locale, 'meta');
	const invite = serverT(locale, 'entry');
	const preview = await lookup(token);
	const heading = !preview
		? meta('invite.title')
		: preview.inviterName
			? invite('invite.guestTitle', { inviter: preview.inviterName, wgName: preview.wgName })
			: invite('invite.guestTitleAnonymous', { wgName: preview.wgName });
	// Some cards show only the description, so it names the invitation too.
	const description = !preview
		? meta('invite.description')
		: [
				heading,
				preview.memberCount >= 2
					? invite('invite.guestMembers', { count: preview.memberCount })
					: null,
				meta('invite.description'),
			]
				.filter(Boolean)
				.join('. ');
	// openGraph/twitter titles do not go through the root title template.
	const title = `${heading} — ManaWG`;
	return {
		title: heading,
		description,
		robots: { index: false, follow: false },
		// Keep the token out of Referer headers.
		referrer: 'no-referrer',
		openGraph: { ...ogBase(locale), title, description },
		twitter: { ...TWITTER_BASE, title, description },
	};
}
