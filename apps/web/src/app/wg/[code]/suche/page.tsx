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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { BackLink } from '@/components/wg/BackLink';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import {
	type WgSearchModule,
	type WgSearchQuickFilter,
	type WgSearchResult,
	filterSearchResults,
	filterSearchResultsByQuickFilter,
} from '@/core/reads/search';
import { cn } from '@/shared/lib/cn';
import { Search, SearchX, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface SearchResponse {
	results: WgSearchResult[];
	suggestions: string[];
}

const MODULE_FILTERS: Array<{ id: WgSearchModule; label: string }> = [
	{ id: 'pinnwand', label: 'Pinnwand' },
	{ id: 'putzen', label: 'Putzen' },
	{ id: 'abwesenheiten', label: 'Abwesenheiten' },
	{ id: 'ausgaben', label: 'Ausgaben' },
	{ id: 'fixkosten', label: 'Fixkosten' },
	{ id: 'einkauf', label: 'Einkauf' },
];

const QUICK_FILTERS: Array<{ id: WgSearchQuickFilter | 'all'; label: string }> = [
	{ id: 'all', label: 'Alle' },
	{ id: 'open', label: 'Offen' },
	{ id: 'mine', label: 'Meine' },
	{ id: 'withImage', label: 'Mit Bild' },
	{ id: 'overdue', label: 'Überfällig' },
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
	if (count === 0) return `Keine sichtbaren Treffer für "${query}".`;
	if (count === 1) return `1 Treffer sichtbar für "${query}".`;
	return `${count} Treffer sichtbar für "${query}".`;
}

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function SuchePage() {
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
	const requestIdRef = useRef(0);

	const load = useCallback(
		async (nextQuery = query): Promise<void> => {
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
					setError(
						getWgLoadErrorMessage('Suche', response.status, await readSearchError(response)),
					);
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
		[encodedShareCode, identity.memberId, query],
	);

	useEffect(() => {
		void load(query);
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
		trimmedQuery.length > 0 && results.length > 0 && visibleResults.length === 0;

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
	}

	return (
		<div className="mx-auto w-full max-w-md space-y-4 bg-background px-4 py-6 pb-[env(safe-area-inset-bottom)]">
			<header className="flex items-center gap-2">
				<BackLink href={wgBaseHref} label="Dashboard" />
				<div className="min-w-0 flex-1">
					<h1 className="text-xl font-semibold tracking-tight text-foreground">WG durchsuchen</h1>
					<p className="mt-0.5 text-[13px] text-muted-foreground">
						Finde Pinnwand, Aufgaben, Ausgaben, Einkauf und Abwesenheiten.
					</p>
				</div>
			</header>

			<Card>
				<CardContent className="pt-4">
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="wg-search">Suchbegriff</FieldLabel>
							<InputGroup className="min-h-11">
								<InputGroupAddon align="inline-start">
									<Search className="h-4 w-4" aria-hidden />
								</InputGroupAddon>
								<InputGroupInput
									id="wg-search"
									type="search"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder="Milch, Bad, Miete..."
									aria-label="Suchbegriff"
									className="min-h-11 text-base"
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
							<div className="flex flex-wrap gap-2" aria-label="Suchvorschläge">
								{suggestions.map((suggestion) => (
									<Button
										key={suggestion}
										type="button"
										variant="outline"
										size="lg"
										onClick={() => setQuery(suggestion)}
										className="min-h-11 rounded-full"
									>
										{suggestion}
									</Button>
								))}
							</div>
						)}

						{/* "Schnellfilter:" steckt in legend/aria-label statt im sichtbaren Text —
						    sichtbar wiederholt es sich sechsmal und treibt die Chips über drei
						    Zeilen. fieldset gruppiert die Chips für Screenreader. */}
						<fieldset className="flex flex-wrap gap-2 border-0 p-0">
							<legend className="sr-only">Schnellfilter</legend>
							{QUICK_FILTERS.map((filter) => (
								<Button
									key={filter.id}
									type="button"
									variant={quickFilter === filter.id ? 'default' : 'outline'}
									size="lg"
									onClick={() => setQuickFilter(filter.id)}
									aria-pressed={quickFilter === filter.id}
									aria-label={`Schnellfilter: ${filter.label}`}
									className="min-h-11 rounded-full"
								>
									{filter.label}
								</Button>
							))}
						</fieldset>

						<Separator />

						<div className="flex flex-wrap gap-2" aria-label="Suchbereiche filtern">
							{MODULE_FILTERS.map((module) => (
								<Button
									key={module.id}
									type="button"
									variant={moduleFilters.includes(module.id) ? 'default' : 'outline'}
									size="lg"
									onClick={() => toggleModule(module.id)}
									aria-pressed={moduleFilters.includes(module.id)}
									className="min-h-11 rounded-full"
								>
									{module.label}
								</Button>
							))}
						</div>
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
					className="flex items-center gap-2 text-[13px] text-muted-foreground"
				>
					{loading && <Spinner className="size-4 motion-reduce:animate-none" aria-hidden />}
					{loading ? 'Suche läuft...' : visibleCountLabel(visibleResults.length, trimmedQuery)}
				</output>
			)}

			{loading && trimmedQuery.length > 0 && (
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
						<p className="text-[13px] text-muted-foreground">Filter blenden alle Treffer aus.</p>
						<Button
							type="button"
							variant="outline"
							size="lg"
							onClick={resetFilters}
							className="mt-3 min-h-11"
						>
							Filter zurücksetzen
						</Button>
					</CardContent>
				</Card>
			)}

			{trimmedQuery.length > 0 && !error && !loading && results.length === 0 && (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<SearchX aria-hidden />
						</EmptyMedia>
						<EmptyTitle>Keine Treffer für &quot;{trimmedQuery}&quot;</EmptyTitle>
						<EmptyDescription>
							Versuche ein kürzeres Wort oder spring direkt in ein Modul.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<div className="flex flex-wrap justify-center gap-2">
							<Link
								href={`${wgBaseHref}/pinnwand`}
								className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'min-h-11')}
							>
								Zur Pinnwand
							</Link>
							<Button
								type="button"
								variant="ghost"
								size="lg"
								onClick={clearSearch}
								className="min-h-11"
							>
								Suchfeld leeren
							</Button>
						</div>
					</EmptyContent>
				</Empty>
			)}

			{visibleResults.length > 0 && (
				<ItemGroup aria-label="Suchergebnisse">
					{visibleResults.map((result) => {
						const moduleLabel =
							MODULE_FILTERS.find((item) => item.id === result.module)?.label ?? result.module;
						return (
							<Item
								key={`${result.module}:${result.id}`}
								variant="outline"
								render={<Link href={result.href} aria-label={`${result.title} — ${moduleLabel}`} />}
							>
								<ItemContent>
									<ItemTitle>{result.title}</ItemTitle>
									<ItemDescription>{result.meta}</ItemDescription>
								</ItemContent>
								<Badge variant="secondary" className="shrink-0">
									{moduleLabel}
								</Badge>
							</Item>
						);
					})}
				</ItemGroup>
			)}

			{hasActiveFilters && visibleResults.length > 0 && (
				<Button type="button" variant="ghost" size="lg" onClick={resetFilters} className="min-h-11">
					Filter zurücksetzen
				</Button>
			)}
		</div>
	);
}
