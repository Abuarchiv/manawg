import { PublicApp } from '@/components/entry/PublicApp';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PUBLIC_MODULES } from './public-modules';

export async function generateMetadata({
	params,
}: { params: Promise<{ module: string }> }): Promise<Metadata> {
	const { module } = await params;
	const entry = PUBLIC_MODULES[module];
	if (!entry) return {};
	return {
		title: `${entry.title} — ManaWG`,
		description: `${entry.description} Die WG-App für Ausgaben, Putzplan, Einkauf und Pinnwand.`,
		alternates: { canonical: `/entdecken/${module}` },
	};
}

export default async function PublicModulePage({
	params,
}: {
	params: Promise<{ module: string }>;
}) {
	const { module } = await params;
	if (!(module in PUBLIC_MODULES)) notFound();
	return <PublicApp activeModule={module} />;
}
