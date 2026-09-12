import {
	Bell,
	CalendarDays,
	Import,
	ListChecks,
	Megaphone,
	MessageCircle,
	Package,
	Receipt,
	Repeat2,
	Sparkles,
} from 'lucide-react';

export const WG_SECTIONS = [
	{
		label: 'Haushalt',
		iconKey: 'haushalt',
		pages: [
			{ slug: 'einkauf', label: 'Einkauf', icon: ListChecks },
			{ slug: 'putzen', label: 'Putzen', icon: Sparkles },
			{ slug: 'vorraete', label: 'Vorräte', icon: Package },
			{ slug: 'kalender', label: 'Termine', icon: CalendarDays },
		],
	},
	{
		label: 'Finanzen',
		iconKey: 'finanzen',
		pages: [
			{ slug: 'ausgaben', label: 'Ausgaben', icon: Receipt },
			{ slug: 'abos', label: 'Fixkosten', icon: Repeat2 },
			{ slug: 'mahnungen', label: 'Mahnungen', icon: Bell },
			{ slug: 'import', label: 'Import', icon: Import },
		],
	},
	{
		label: 'Austausch',
		iconKey: 'austausch',
		pages: [
			{ slug: 'pinnwand', label: 'Pinnwand', icon: Megaphone },
			{ slug: 'chat', label: 'Chat', icon: MessageCircle },
		],
	},
] as const;

export function getWgSection(pathname: string) {
	const match = pathname.match(/^(\/wg\/[^/]+)\/([^/]+)/);
	if (!match) return null;
	const section = WG_SECTIONS.find((item) => item.pages.some((page) => page.slug === match[2]));
	return section ? { ...section, baseHref: match[1] } : null;
}
