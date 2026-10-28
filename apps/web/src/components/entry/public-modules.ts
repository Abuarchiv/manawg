/** Public discovery modules: slugs in display order, titles and descriptions live in `entry.modules`. */
export const PRIMARY_MODULE_SLUGS = ['ausgaben', 'einkauf', 'pinnwand', 'putzen'] as const;

const OTHER_MODULE_SLUGS = [
	'fixkosten',
	'mahnungen',
	'vorraete',
	'kalender',
	'aktivitaet',
	'chat',
] as const;

export type PublicModuleSlug =
	| (typeof PRIMARY_MODULE_SLUGS)[number]
	| (typeof OTHER_MODULE_SLUGS)[number];

const ALL_SLUGS: readonly string[] = [...PRIMARY_MODULE_SLUGS, ...OTHER_MODULE_SLUGS];

export function isPublicModuleSlug(slug: string): slug is PublicModuleSlug {
	return ALL_SLUGS.includes(slug);
}
