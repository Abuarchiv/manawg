import { formatEuroCents } from '@/core/utils/money';
import { formatShortDateRange, parseTimestamp } from '@/core/utils/time';

export type WgSearchModule =
	| 'pinnwand'
	| 'putzen'
	| 'ausgaben'
	| 'fixkosten'
	| 'einkauf'
	| 'abwesenheiten';
export type WgSearchQuickFilter = 'open' | 'mine' | 'withImage' | 'overdue' | 'unpaid';

export interface WgSearchResult {
	id: string;
	module: WgSearchModule;
	title: string;
	meta: string;
	href: string;
	tags?: WgSearchQuickFilter[];
}

interface WgSearchGroup {
	module: WgSearchModule;
	count: number;
	results: WgSearchResult[];
}

interface SearchHighlightSegment {
	text: string;
	match: boolean;
}

interface SearchSuggestionInput {
	openShoppingTop: string[];
	dueChoreTitles: string[];
	dueRecurringDescriptions: string[];
	latestAnnouncementContent: string | null;
}

interface SearchInput {
	currentMemberId?: string | null;
	shareCode: string;
	announcements: Array<{
		id: string;
		content: string;
		createdAt: string;
		authorMemberId?: string;
		imageUrl?: string | null;
		status?: 'open' | 'resolved' | string;
	}>;
	chores: Array<{ id: string; title: string; nextDueAt: string; assignedMemberId?: string | null }>;
	expenses: Array<{
		id: string;
		description: string;
		amountCents: number;
		occurredAt: string;
		paidByMemberId?: string;
		imageUrl?: string | null;
		splits?: Array<{ settledAt: string | null }>;
	}>;
	recurringExpenses: Array<{
		id: string;
		description: string;
		amountCents: number;
		intervalMonths: number;
		nextDueAt: string;
		paidByMemberId?: string;
	}>;
	shoppingItems: Array<{
		id: string;
		name: string;
		quantity: string | null;
		boughtAt: string | null;
		addedByMemberId?: string;
	}>;
	absences?: Array<{
		id: string;
		memberId: string;
		memberName: string;
		startDate: string;
		endDate: string;
		reason: string | null;
	}>;
}

function includesQuery(value: string, query: string): boolean {
	return value.toLocaleLowerCase('de-DE').includes(query);
}

function cleanSuggestion(value: string): string {
	return value
		.replace(/\s*\([^)]*\)\s*$/u, '')
		.trim()
		.split(/\s+/u)
		.slice(0, 3)
		.join(' ');
}

function expenseHasOpenSplit(expense: SearchInput['expenses'][number]): boolean {
	if (!expense.splits) return true;
	return expense.splits.some((split) => split.settledAt === null);
}

export function filterSearchResults(
	results: WgSearchResult[],
	modules: WgSearchModule[],
): WgSearchResult[] {
	if (modules.length === 0) return results;
	const allowed = new Set(modules);
	return results.filter((result) => allowed.has(result.module));
}

export function filterSearchResultsByQuickFilter(
	results: WgSearchResult[],
	filter: WgSearchQuickFilter | 'all',
): WgSearchResult[] {
	if (filter === 'all') return results;
	return results.filter((result) => result.tags?.includes(filter));
}

export function groupSearchResults(results: WgSearchResult[]): WgSearchGroup[] {
	const order: WgSearchModule[] = [
		'pinnwand',
		'putzen',
		'abwesenheiten',
		'ausgaben',
		'fixkosten',
		'einkauf',
	];
	return order
		.map((module) => {
			const groupResults = results.filter((result) => result.module === module);
			return { module, count: groupResults.length, results: groupResults };
		})
		.filter((group) => group.count > 0);
}

export function highlightSearchMatch(text: string, rawQuery: string): SearchHighlightSegment[] {
	const query = rawQuery.trim();
	if (!query) return [{ text, match: false }];
	const lowerText = text.toLocaleLowerCase('de-DE');
	const lowerQuery = query.toLocaleLowerCase('de-DE');
	const index = lowerText.indexOf(lowerQuery);
	if (index < 0) return [{ text, match: false }];

	const segments: SearchHighlightSegment[] = [];
	if (index > 0) segments.push({ text: text.slice(0, index), match: false });
	segments.push({ text: text.slice(index, index + query.length), match: true });
	if (index + query.length < text.length) {
		segments.push({ text: text.slice(index + query.length), match: false });
	}
	return segments;
}

export function getSearchSuggestions(input: SearchSuggestionInput): string[] {
	const suggestions = [
		...input.openShoppingTop,
		...input.dueChoreTitles,
		...input.dueRecurringDescriptions,
		input.latestAnnouncementContent,
	]
		.filter((value): value is string => Boolean(value))
		.map(cleanSuggestion)
		.filter((value) => value.length > 0);

	return Array.from(new Set(suggestions)).slice(0, 6);
}

export function searchWgItems(rawQuery: string, input: SearchInput): WgSearchResult[] {
	const query = rawQuery.trim().toLocaleLowerCase('de-DE');
	if (!query) return [];

	const base = `/wg/${encodeURIComponent(input.shareCode)}`;
	const results: WgSearchResult[] = [];

	for (const item of input.announcements) {
		if (!includesQuery(item.content, query)) continue;
		results.push({
			id: item.id,
			module: 'pinnwand',
			title: item.content,
			meta: 'Pinnwand',
			href: `${base}/pinnwand#announcement-${encodeURIComponent(item.id)}`,
			tags: [
				item.status !== 'resolved' ? 'open' : null,
				item.imageUrl ? 'withImage' : null,
				item.authorMemberId && item.authorMemberId === input.currentMemberId ? 'mine' : null,
			].filter((tag): tag is WgSearchQuickFilter => tag !== null),
		});
	}

	for (const item of input.chores) {
		if (!includesQuery(item.title, query)) continue;
		results.push({
			id: item.id,
			module: 'putzen',
			title: item.title,
			meta: 'Putzplan',
			href: `${base}/putzen?highlight=${encodeURIComponent(item.id)}`,
			tags: [
				isPast(item.nextDueAt) ? 'overdue' : null,
				item.assignedMemberId && item.assignedMemberId === input.currentMemberId ? 'mine' : null,
			].filter((tag): tag is WgSearchQuickFilter => tag !== null),
		});
	}

	for (const item of input.expenses) {
		if (!includesQuery(item.description, query)) continue;
		results.push({
			id: item.id,
			module: 'ausgaben',
			title: item.description,
			meta: formatEuroCents(item.amountCents),
			href: `${base}/ausgaben?highlight=${encodeURIComponent(item.id)}`,
			tags: [
				expenseHasOpenSplit(item) ? 'unpaid' : null,
				item.imageUrl ? 'withImage' : null,
				item.paidByMemberId && item.paidByMemberId === input.currentMemberId ? 'mine' : null,
			].filter((tag): tag is WgSearchQuickFilter => tag !== null),
		});
	}

	for (const item of input.recurringExpenses) {
		const searchable = `fixkosten ${item.description}`;
		if (!includesQuery(searchable, query)) continue;
		const intervalLabel =
			item.intervalMonths === 1 ? 'monatlich' : `alle ${item.intervalMonths} Monate`;
		results.push({
			id: item.id,
			module: 'fixkosten',
			title: item.description,
			meta: `${formatEuroCents(item.amountCents)} · ${intervalLabel}`,
			href: `${base}/ausgaben?recurring=${encodeURIComponent(item.id)}`,
			tags: [
				isPast(item.nextDueAt) ? 'overdue' : null,
				item.paidByMemberId && item.paidByMemberId === input.currentMemberId ? 'mine' : null,
			].filter((tag): tag is WgSearchQuickFilter => tag !== null),
		});
	}

	for (const item of input.shoppingItems) {
		const searchable = item.quantity ? `${item.name} ${item.quantity}` : item.name;
		if (!includesQuery(searchable, query)) continue;
		results.push({
			id: item.id,
			module: 'einkauf',
			title: item.quantity ? `${item.name} (${item.quantity})` : item.name,
			meta: item.boughtAt ? 'Einkauf · erledigt' : 'Einkauf · offen',
			href: `${base}/einkauf?highlight=${encodeURIComponent(item.id)}`,
			tags: [
				item.boughtAt ? null : 'open',
				item.addedByMemberId && item.addedByMemberId === input.currentMemberId ? 'mine' : null,
			].filter((tag): tag is WgSearchQuickFilter => tag !== null),
		});
	}

	for (const item of input.absences ?? []) {
		const searchable = `${item.memberName} ${item.reason ?? ''} abwesenheit abwesend`;
		if (!includesQuery(searchable, query)) continue;
		const dateRange = formatShortDateRange(item.startDate, item.endDate);
		results.push({
			id: item.id,
			module: 'abwesenheiten',
			title: `${item.memberName} ist abwesend`,
			meta: item.reason ? `${dateRange} · ${item.reason}` : dateRange,
			href: `${base}/putzen?panel=absences&absence=${encodeURIComponent(item.id)}`,
			tags: [
				isCurrentOrFuture(item.endDate) ? 'open' : null,
				item.memberId && item.memberId === input.currentMemberId ? 'mine' : null,
			].filter((tag): tag is WgSearchQuickFilter => tag !== null),
		});
	}

	return results.slice(0, 12);
}

function isPast(iso: string, now = Date.now()): boolean {
	const timestamp = parseTimestamp(iso);
	return timestamp !== null && timestamp < now;
}

function isCurrentOrFuture(iso: string, now = Date.now()): boolean {
	const timestamp = parseTimestamp(iso);
	return timestamp !== null && timestamp >= now;
}
