import type { Metadata } from 'next';
import { getLocale } from 'next-intl/server';
import { InviteClient } from './InviteClient';
import { inviteMetadata } from './invite-metadata';

// Dynamic, so the metadata of one token is never cached for another.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
	params,
}: {
	params: Promise<{ token: string }>;
}): Promise<Metadata> {
	const [{ token }, locale] = await Promise.all([params, getLocale()]);
	return inviteMetadata(token, locale);
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = await params;
	return <InviteClient token={token} />;
}
