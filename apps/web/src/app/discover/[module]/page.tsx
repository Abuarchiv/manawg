import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PublicApp } from '@/components/entry/PublicApp';
import { isPublicModuleSlug } from '@/components/entry/public-modules';
import { OG_BASE, TWITTER_BASE } from '@/shared/lib/og';

// Demo modules duplicate the topic pages on manawg.com; the landing ranks, these pages
// stay noindex (layout). No canonical here: combined with noindex it is a contradictory
// signal, and a self-canonical on a noindex page is pointless.
export async function generateMetadata({
	params,
}: {
	params: Promise<{ module: string }>;
}): Promise<Metadata> {
	const { module } = await params;
	if (!isPublicModuleSlug(module)) notFound();
	const [t, meta] = await Promise.all([getTranslations('entry.modules'), getTranslations('meta')]);
	// openGraph/twitter titles do not go through the root title template.
	const title = `${t(`${module}.title`)} — ManaWG`;
	const description = meta('discover.description', { description: t(`${module}.description`) });
	return {
		title: t(`${module}.title`),
		description,
		// Shared links (chat previews) show the module, not the generic app card from the layout.
		openGraph: { ...OG_BASE, title, description, url: `/discover/${module}` },
		twitter: { ...TWITTER_BASE, title, description },
	};
}

export default async function PublicModulePage({
	params,
}: {
	params: Promise<{ module: string }>;
}) {
	const { module } = await params;
	if (!isPublicModuleSlug(module)) notFound();
	return <PublicApp activeModule={module} />;
}
