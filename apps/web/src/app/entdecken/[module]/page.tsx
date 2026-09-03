import { PublicApp } from '@/components/entry/PublicApp';
import { notFound } from 'next/navigation';

const PUBLIC_MODULES = new Set([
	'ausgaben',
	'einkauf',
	'pinnwand',
	'putzen',
	'fixkosten',
	'mahnungen',
	'vorraete',
	'kalender',
	'aktivitaet',
	'chat',
	'einstellungen',
]);

export default async function PublicModulePage({
	params,
}: {
	params: Promise<{ module: string }>;
}) {
	const { module } = await params;
	if (!PUBLIC_MODULES.has(module)) notFound();
	return <PublicApp activeModule={module} />;
}
