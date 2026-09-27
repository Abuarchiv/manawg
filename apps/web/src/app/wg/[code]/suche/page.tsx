'use client';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from '@/components/ui/input-group';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { BackLink } from '@/components/wg/BackLink';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { useDocumentTitle } from '@/core/hooks/useDocumentTitle';
import {
	type WgSearchModule,
	type WgSearchQuickFilter,
	type WgSearchResult,
	filterSearchResults,
	filterSearchResultsByQuickFilter,
} from '@/core/reads/search';
import { ChevronRight, Search, SearchX, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface SearchResponse {
	results: WgSearchResult[];
	suggestions: string[];
}

const SEARCH_DEBOUNCE_MS = 300;

const MODULE_FILTERS: Array<{ id: WgSearchModule; label: string }> = [
	{ id: 'pinnwand', label: 'Pinnwand' },
	{ id: 'putzen', label: 'Putzplan' },
	{ id: 'abwesenheiten', label: 'Abwesenheiten' },
	{ id: 'ausgaben', label: 'Ausgaben' },
	{ id: 'fixkosten', label: 'Fixkosten' },
	{ id: 'einkauf', label: 'Einkäufe' },
];

const QUICK_FILTERS: Array<{ id: WgSearchQuickFilter | 'all'; label: string }> = [
	{ id: 'all', label: 'Alle' },
	{ id: 'open', label: 'Offen' },
	{ id: 'mine', label: 'Meine' },
	{ id: 'withImage', label: 'Mit Bild' },
	{ id: 'overdue', label: 'Noch offen' },
	{ id: 'unpaid', label: 'Unbezahlt' },
];

async function readSearchError(response: Response): Promise<string | null> {
	try {
		const body = (await response.clone().json()) as { code?: unknown; error?: unknown };
		if (typeof body.code === 'string') return body.code;
		if (typeof body.error === 'string') return body.error;
	} catch {
		return null;
	}
	return null;
}

function visibleCountLabel(count: number, query: string): string {
	if (count === 0) return `Keine sichtbaren Treffer für „${query}“.`;
	if (count === 1) return `1 Treffer sichtbar für „${query}“.`;
	return `${count} Treffer sichtbar für „${query}“.`;
}

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function SuchePage() {
	useDocumentTitle('WG durchsuchen — ManaWG');
	const { wg, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<WgSearchResult[]>([]);
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [quickFilter, setQuickFilter] = useState<WgSearchQuickFilter | 'all'>('all');
	const [moduleFilters, setModuleFilters] = useState<WgSearchModule[]>([]);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const requestIdRef = useRef(0);

	const load = useCallback(
		async (nextQuery: string): Promise<void> => {
			const requestId = requestIdRef.current + 1;
			requestIdRef.current = requestId;
			setLoading(true);
			try {
				const params = new URLSearchParams({ q: nextQuery });
				const response = await fetch(`/api/wg/${encodedShareCode}/search?${params.toString()}`, {
					cache: 'no-store',
					headers: { 'x-manawg-member-id': identity.memberId },
				});
				if (requestId !== requestIdRef.current) return;
				if (!response.ok) {
					const errorCode = await readSearchError(response);
					if (requestId !== requestIdRef.current) return;
					setError(getWgLoadErrorMessage('Suche', response.status, errorCode));
					return;
				}
				const body = (await response.json()) as SearchResponse;
				if (requestId !== requestIdRef.current) return;
				setResults(body.results ?? []);
				setSuggestions(body.suggestions ?? []);
				setError(null);
			} catch {
				if (requestId !== requestIdRef.current) return;
				setError(getWgLoadErrorMessage('Suche', 0, 'Netzwerkfehler'));
			} finally {
				if (requestId === requestIdRef.current) setLoading(false);
			}
		},
		[encodedShareCode, identity.memberId],
	);

	useEffect(() => {
		// Invalidate an in-flight request as soon as the query changes. The next
		// request starts only after typing pauses, so stale results remain visible
		// without a second set of placeholder rows.
		requestIdRef.current += 1;
		setLoading(true);
		const timeoutId = window.setTimeout(() => {
			void load(query);
		}, SEARCH_DEBOUNCE_MS);
		return () => window.clearTimeout(timeoutId);
	}, [load, query]);
	// Bewusst kein Auto-Refresh: die Trefferliste würde unter der lesenden oder
	// tippenden Person neu sortiert. Eine Suche lädt neu, wenn die Query sich ändert.

	const visibleResults = useMemo(
		() =>
			filterSearchResultsByQuickFilter(filterSearchResults(results, moduleFilters), quickFilter),
		[results, moduleFilters, quickFilter],
	);
	const trimmedQuery = query.trim();
	const hasActiveFilters = quickFilter !== 'all' || moduleFilters.length > 0;
	const filtersHideResults =
		!error && trimmedQuery.length > 0 && results.length > 0 && visibleResults.length === 0;

	function toggleModule(module: WgSearchModule): void {
		setModuleFilters((current) =>
			current.includes(module) ? current.filter((item) => item !== module) : [...current, module],
		);
	}

	function resetFilters(): void {
		setQuickFilter('all');
		setModuleFilters([]);
	}

	function clearSearch(): void {
		setQuery('');
		setResults([]);
		setError(null);
		resetFilters();
		searchInputRef.current?.focus();
	}

	return (
		<div className="mx-auto min-w-0 w-full max-w-3xl space-y-4 bg-background px-4 py-4 pb-[env(safe-area-inset-bottom)]">
			<header className="flex items-start gap-2">
				<BackLink href={wgBaseHref} label="Dashboard" />
				<div className="min-w-0 flex-1">
					<h1 className="font-heading text-lg font-semibold tracking-tight break-words text-foreground">
						WG durchsuchen
					</h1>
					<p className="mt-0.5 text-[12px] text-muted-foreground">
						Finde Pinnwand, Aufgaben, Ausgaben, Einkauf und Abwesenheiten.
					</p>
				</div>
			</header>

			<Card className="overflow-visible border-0 bg-transparent py-0 shadow-none">
				<CardContent className="p-0">
					<FieldGroup className="gap-3">
						<Field>
							<FieldLabel htmlFor="wg-search" className="sr-only">
								Suchbegriff
							</FieldLabel>
							<InputGroup>
								<InputGroupAddon align="inline-start">
									<Search className="h-4 w-4" aria-hidden />
								</InputGroupAddon>
								<InputGroupInput
									id="wg-search"
									ref={searchInputRef}
									type="text"
									role="searchbox"
									enterKeyHint="search"
									maxLength={80}
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder="Milch, Bad, Miete…"
									aria-label="Suchbegriff"
									className="min-h-11 text-base [&::-webkit-search-cancel-button]:hidden"
								/>
								{query.length > 0 && (
									<InputGroupAddon align="inline-end">
										<InputGroupButton
											type="button"
											onClick={clearSearch}
											aria-label="Suche leeren"
											size="icon-sm"
											className="min-h-11 min-w-11"
										>
											<X aria-hidden />
										</InputGroupButton>
									</InputGroupAddon>
								)}
							</InputGroup>
						</Field>

						{suggestions.length > 0 && query.length === 0 && (
							// biome-ignore lint/a11y/useSemanticElements: role="group" names the suggestion chips; <fieldset> would change the layout semantics.
							<div className="flex flex-wrap gap-2" aria-label="Suchvorschläge" role="group">
								{suggestions.map((suggestion) => (
									<Button
										key={suggestion}
										type="button"
										variant="outline"
										size="sm"
										onClick={() => setQuery(suggestion)}
										className="rounded-lg"
									>
										{suggestion}
									</Button>
								))}
							</div>
						)}

						<Field>
							<FieldLabel htmlFor="search-quick-filter">Status</FieldLabel>
							<NativeSelect
								id="search-quick-filter"
								value={quickFilter}
								onChange={(event) =>
									setQuickFilter(event.target.value as WgSearchQuickFilter | 'all')
								}
								className="w-full [&_select]:min-h-10"
							>
								{QUICK_FILTERS.map((filter) => (
									<NativeSelectOption key={filter.id} value={filter.id}>
										{filter.label}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</Field>

						<details className="group">
							<summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
								<ChevronRight
									aria-hidden
									className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
								/>
								<span className="flex-1">Bereiche eingrenzen</span>
								{moduleFilters.length > 0 && (
									<span className="text-muted-foreground text-xs font-normal">
										{moduleFilters.length} ausgewählt
									</span>
								)}
							</summary>
							<fieldset className="flex flex-wrap gap-2 pt-1">
								<legend className="sr-only">Suchbereiche filtern</legend>
								{MODULE_FILTERS.map((module) => (
									<Button
										key={module.id}
										type="button"
										variant={moduleFilters.includes(module.id) ? 'default' : 'outline'}
										size="sm"
										onClick={() => toggleModule(module.id)}
										aria-pressed={moduleFilters.includes(module.id)}
										className="rounded-lg"
									>
										{module.label}
									</Button>
								))}
							</fieldset>
						</details>
					</FieldGroup>
				</CardContent>
			</Card>

			{error && (
				<LoadErrorBanner
					message={error}
					onRetry={() => void load(query)}
					busy={loading}
					retryLabel="Suche erneut laden"
				/>
			)}

			{trimmedQuery.length > 0 && !error && (
				<output
					aria-live="polite"
					className="flex items-center gap-2 text-[12px] text-muted-foreground"
				>
					{loading && <Spinner className="size-4 motion-reduce:animate-none" aria-hidden />}
					<span className="min-w-0 [overflow-wrap:anywhere]">
						{loading ? 'Suche läuft…' : visibleCountLabel(visibleResults.length, trimmedQuery)}
					</span>
				</output>
			)}

			{loading && trimmedQuery.length > 0 && results.length === 0 && (
				<ItemGroup aria-label="Suche lädt">
					{[0, 1, 2].map((index) => (
						<Item key={index} variant="outline">
							<ItemContent>
								<Skeleton className="h-4 w-3/4" />
								<Skeleton className="h-3 w-1/2" />
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
			)}

			{filtersHideResults && (
				<Card>
					<CardContent className="pt-4">
						<p className="text-[12px] text-muted-foreground">Filter blenden alle Treffer aus.</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={resetFilters}
							className="mt-3"
						>
							Filter zurücksetzen
						</Button>
					</CardContent>
				</Card>
			)}

			{trimmedQuery.length > 0 && !error && !loading && results.length === 0 && (
				<Empty className="gap-3 border-0 px-0 py-5">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<SearchX aria-hidden />
						</EmptyMedia>
						<EmptyTitle>Keine Treffer für „{trimmedQuery}“</EmptyTitle>
						<EmptyDescription>
							Versuche ein kürzeres Wort oder spring direkt in ein Modul.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<div className="flex flex-wrap justify-center gap-2">
							<Link
								href={`${wgBaseHref}/pinnwand`}
								className={buttonVariants({ variant: 'outline', size: 'sm' })}
							>
								Zur Pinnwand
							</Link>
							<Button type="button" variant="ghost" size="sm" onClick={clearSearch}>
								Suchfeld leeren
							</Button>
						</div>
					</EmptyContent>
				</Empty>
			)}

			{!error && visibleResults.length > 0 && (
				<ItemGroup aria-label="Suchergebnisse">
					{visibleResults.map((result) => {
						const moduleLabel =
							MODULE_FILTERS.find((item) => item.id === result.module)?.label ?? result.module;
						return (
							<Item
								key={`${result.module}:${result.id}`}
								size="sm"
								className="rounded-none border-b border-border last:border-0"
								render={<Link href={result.href} aria-label={`${result.title} — ${moduleLabel}`} />}
							>
								<ItemContent className="min-w-0 flex-[1_0_7rem]">
									<ItemTitle className="min-w-0 w-full">{result.title}</ItemTitle>
									<ItemDescription className="min-w-0">{result.meta}</ItemDescription>
								</ItemContent>
								<Badge variant="secondary" className="shrink-0">
									{moduleLabel}
								</Badge>
							</Item>
						);
					})}
				</ItemGroup>
			)}

			{!error && hasActiveFilters && visibleResults.length > 0 && (
				<Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
					Filter zurücksetzen
				</Button>
			)}
		</div>
	);
}
