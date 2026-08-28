'use client';

import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import {
	type WgSearchModule,
	type WgSearchQuickFilter,
	type WgSearchResult,
	filterSearchResults,
	filterSearchResultsByQuickFilter,
} from '@/lib/wg/search';
import { ArrowLeft, Search, X } from 'lucide-react';
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
		<div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
			<header className="flex items-center gap-3">
				<Link
					href={wgBaseHref}
					aria-label="Zurück zum Dashboard"
					className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)]"
				>
					<ArrowLeft className="h-4 w-4" aria-hidden />
				</Link>
				<div className="min-w-0 flex-1">
					<h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
						WG durchsuchen
					</h1>
					<p className="mt-0.5 text-[13px] text-[var(--text-3)]">
						Finde Pinnwand, Aufgaben, Ausgaben, Einkauf und Abwesenheiten.
					</p>
				</div>
			</header>

			<section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-3">
				<label className="block text-[12px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
					Suchbegriff
					<span className="mt-2 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3">
						<Search className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden />
						<input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Milch, Bad, Miete..."
							className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
						/>
						{query.length > 0 && (
							<button
								type="button"
								onClick={clearSearch}
								aria-label="Suche leeren"
								className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-3)] transition hover:bg-[var(--bg-base)] hover:text-[var(--text-1)]"
							>
								<X className="h-4 w-4" aria-hidden />
							</button>
						)}
					</span>
				</label>

				{suggestions.length > 0 && query.length === 0 && (
					<div className="flex flex-wrap gap-2" aria-label="Suchvorschläge">
						{suggestions.map((suggestion) => (
							<button
								key={suggestion}
								type="button"
								onClick={() => setQuery(suggestion)}
								className="inline-flex h-11 items-center rounded-full border border-[var(--border)] px-3 text-[12.5px] font-medium text-[var(--text-2)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-1)]"
							>
								{suggestion}
							</button>
						))}
					</div>
				)}

				<div className="flex flex-wrap gap-2" aria-label="Schnellfilter">
					{QUICK_FILTERS.map((filter) => (
						<button
							key={filter.id}
							type="button"
							onClick={() => setQuickFilter(filter.id)}
							aria-pressed={quickFilter === filter.id}
							className={`inline-flex h-11 items-center rounded-full border px-3 text-[12.5px] font-medium transition ${
								quickFilter === filter.id
									? 'border-[var(--text-1)] bg-[var(--text-1)] text-[var(--bg-base)]'
									: 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
							}`}
						>
							Schnellfilter: {filter.label}
						</button>
					))}
				</div>

				<div
					className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3"
					aria-label="Suchbereiche filtern"
				>
					{MODULE_FILTERS.map((module) => (
						<button
							key={module.id}
							type="button"
							onClick={() => toggleModule(module.id)}
							aria-pressed={moduleFilters.includes(module.id)}
							className={`inline-flex h-11 items-center rounded-full border px-3 text-[12.5px] font-medium transition ${
								moduleFilters.includes(module.id)
									? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
									: 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
							}`}
						>
							{module.label}
						</button>
					))}
				</div>
			</section>

			{error && (
				<LoadErrorBanner
					message={error}
					onRetry={() => void load(query)}
					busy={loading}
					retryLabel="Suche erneut laden"
				/>
			)}

			{trimmedQuery.length > 0 && !error && (
				<output className="text-[13px] text-[var(--text-3)]">
					{loading ? 'Suche läuft...' : visibleCountLabel(visibleResults.length, trimmedQuery)}
				</output>
			)}

			{filtersHideResults && (
				<div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-[13px] text-[var(--text-2)]">
					<p>Filter blenden alle Treffer aus.</p>
					<button
						type="button"
						onClick={resetFilters}
						className="mt-2 inline-flex h-11 items-center rounded-md border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-1)]"
					>
						Filter zurücksetzen
					</button>
				</div>
			)}

			{trimmedQuery.length > 0 && !error && !loading && results.length === 0 && (
				<section className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center">
					<h2 className="text-[16px] font-semibold text-[var(--text-1)]">
						Keine Treffer für "{trimmedQuery}"
					</h2>
					<p className="mt-1 text-[13px] text-[var(--text-3)]">
						Versuche ein kürzeres Wort oder spring direkt in ein Modul.
					</p>
					<div className="mt-4 flex flex-wrap justify-center gap-2">
						<Link
							href={`${wgBaseHref}/pinnwand`}
							className="inline-flex h-11 items-center rounded-md border border-[var(--border)] px-3 text-[12.5px] font-medium"
						>
							Zur Pinnwand
						</Link>
						<button
							type="button"
							onClick={clearSearch}
							className="inline-flex h-11 items-center rounded-md border border-[var(--border)] px-3 text-[12.5px] font-medium"
						>
							Suchfeld leeren
						</button>
					</div>
				</section>
			)}

			{visibleResults.length > 0 && (
				<ul className="space-y-2">
					{visibleResults.map((result) => (
						<li key={`${result.module}:${result.id}`}>
							<Link
								href={result.href}
								className="block rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 transition hover:border-[var(--border-strong)]"
							>
								<span className="block text-[15px] font-medium text-[var(--text-1)]">
									{result.title}
								</span>
								<span className="mt-1 block text-[12.5px] text-[var(--text-3)]">{result.meta}</span>
							</Link>
						</li>
					))}
				</ul>
			)}

			{hasActiveFilters && visibleResults.length > 0 && (
				<button
					type="button"
					onClick={resetFilters}
					className="inline-flex h-11 items-center rounded-md border border-[var(--border)] px-3 text-[12.5px] font-medium text-[var(--text-2)]"
				>
					Filter zurücksetzen
				</button>
			)}
		</div>
	);
}
