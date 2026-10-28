import {
	CalendarDays,
	ListChecks,
	Megaphone,
	MessageCircle,
	Package,
	Receipt,
	Repeat2,
	Sparkles,
} from 'lucide-react';

/** Labels are `shell.nav.*` catalog keys; `NavItem` and `SubNav` render them. */
export const HOME_NAV_LABEL = 'shell.nav.home';

export const WG_SECTIONS = [
	{
		label: 'shell.nav.household',
		iconKey: 'haushalt',
		pages: [
			{ slug: 'putzen', label: 'shell.nav.cleaning', icon: Sparkles },
			{ slug: 'einkauf', label: 'shell.nav.shopping', icon: ListChecks },
			{ slug: 'vorraete', label: 'shell.nav.supplies', icon: Package },
		],
		related: [],
	},
	{
		label: 'shell.nav.finance',
		iconKey: 'finanzen',
		pages: [
			{ slug: 'ausgaben', label: 'shell.nav.expenses', icon: Receipt },
			{ slug: 'abos', label: 'shell.nav.fixedCosts', icon: Repeat2 },
		],
		// Finance actions with their own page: no segment, but the tab stays active.
		related: ['mahnungen', 'import', 'abrechnung'],
	},
	{
		label: 'shell.nav.exchange',
		iconKey: 'austausch',
		pages: [
			{ slug: 'pinnwand', label: 'shell.nav.noticeboard', icon: Megaphone },
			{ slug: 'chat', label: 'shell.nav.chat', icon: MessageCircle },
			{ slug: 'kalender', label: 'shell.nav.calendar', icon: CalendarDays },
		],
		related: [],
	},
] as const;

/** The Fixkosten page lives under the route slug `abos` in the app but `fixkosten` on public pages. */
const ROUTE_TO_MODULE_SLUG: Record<string, string> = { abos: 'fixkosten' };

export function moduleSlugOf(pageSlug: string): string {
	return ROUTE_TO_MODULE_SLUG[pageSlug] ?? pageSlug;
}

/** Whether the module named in the URL belongs to the section page with this slug. */
export function isActivePage(pageSlug: string, activeModule: string | undefined): boolean {
	return activeModule !== undefined && moduleSlugOf(pageSlug) === moduleSlugOf(activeModule);
}

export function getWgSection(pathname: string) {
	const match = pathname.match(/^(\/wg\/[^/]+)\/([^/]+)/);
	if (!match) return null;
	const section = WG_SECTIONS.find((item) => item.pages.some((page) => page.slug === match[2]));
	return section ? { ...section, baseHref: match[1] } : null;
}
