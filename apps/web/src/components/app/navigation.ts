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
		iconKey: 'household',
		pages: [
			{ slug: 'chores', label: 'shell.nav.cleaning', icon: Sparkles },
			{ slug: 'shopping', label: 'shell.nav.shopping', icon: ListChecks },
			{ slug: 'supplies', label: 'shell.nav.supplies', icon: Package },
		],
		related: [],
	},
	{
		label: 'shell.nav.finance',
		iconKey: 'finances',
		pages: [
			{ slug: 'expenses', label: 'shell.nav.expenses', icon: Receipt },
			{ slug: 'recurring', label: 'shell.nav.fixedCosts', icon: Repeat2 },
		],
		// Finance actions with their own page: no segment, but the tab stays active.
		related: ['reminders', 'import', 'statement'],
	},
	{
		label: 'shell.nav.exchange',
		iconKey: 'community',
		pages: [
			{ slug: 'pinboard', label: 'shell.nav.noticeboard', icon: Megaphone },
			{ slug: 'chat', label: 'shell.nav.chat', icon: MessageCircle },
			{ slug: 'calendar', label: 'shell.nav.calendar', icon: CalendarDays },
		],
		related: [],
	},
] as const;

/** Whether the module named in the URL belongs to the section page with this slug. */
export function isActivePage(pageSlug: string, activeModule: string | undefined): boolean {
	return pageSlug === activeModule;
}

export function getWgSection(pathname: string) {
	const match = pathname.match(/^(\/wg\/[^/]+)\/([^/]+)/);
	if (!match) return null;
	const section = WG_SECTIONS.find((item) => item.pages.some((page) => page.slug === match[2]));
	return section ? { ...section, baseHref: match[1] } : null;
}
