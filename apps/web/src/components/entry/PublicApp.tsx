'use client';

import { WgWelcome } from '@/components/entry/WgWelcome';
import { ErrorBox } from '@/components/neu/ErrorBox';
import { NavItem } from '@/components/wg/NavItem';
import { ModuleCard } from '@/components/wg/dashboard/ModuleCard';
import { LogoMark } from '@/shared/components/ui/LogoMark';
import { isValidShareCode, normalizeShareCode } from '@/shared/lib/share-code';
import { ListChecks, type LucideIcon, Megaphone, Receipt, Settings, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

interface AccountWg {
	id: string;
	code: string;
	name: string;
}

interface PublicModule {
	slug: string;
	title: string;
	description: string;
	Icon: LucideIcon;
}

const PRIMARY_MODULES: PublicModule[] = [
	{
		slug: 'ausgaben',
		title: 'Ausgaben',
		description: 'Gemeinsame Kosten im Blick.',
		Icon: Receipt,
	},
	{
		slug: 'einkauf',
		title: 'Einkauf',
		description: 'Die nächste Einkaufsliste.',
		Icon: ListChecks,
	},
	{ slug: 'pinnwand', title: 'Pinnwand', description: 'Infos für alle.', Icon: Megaphone },
	{ slug: 'putzen', title: 'Putzen', description: 'Aufgaben fair verteilen.', Icon: Sparkles },
];

const OTHER_MODULES: PublicModule[] = [
	{ slug: 'fixkosten', title: 'Fixkosten', description: 'Regelmäßige Kosten.', Icon: Receipt },
	{
		slug: 'mahnungen',
		title: 'Mahnungen',
		description: 'Offene Beträge nachhalten.',
		Icon: Receipt,
	},
	{ slug: 'vorraete', title: 'Vorräte', description: 'Was noch da ist.', Icon: ListChecks },
	{ slug: 'kalender', title: 'Kalender', description: 'Gemeinsame Termine.', Icon: Settings },
	{
		slug: 'aktivitaet',
		title: 'Aktivität',
		description: 'Was zuletzt passiert ist.',
		Icon: Settings,
	},
	{ slug: 'chat', title: 'Chat', description: 'Kurz etwas klären.', Icon: Megaphone },
	{
		slug: 'einstellungen',
		title: 'Einstellungen',
		description: 'Die WG verwalten.',
		Icon: Settings,
	},
];

const PUBLIC_MODULES = [...PRIMARY_MODULES, ...OTHER_MODULES];

function isAccountWg(value: unknown): value is AccountWg {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const id = Reflect.get(value, 'id');
	const code = Reflect.get(value, 'code');
	const name = Reflect.get(value, 'name');
	return (
		typeof id === 'string' &&
		id.length > 0 &&
		typeof code === 'string' &&
		isValidShareCode(normalizeShareCode(code)) &&
		typeof name === 'string' &&
		name.trim().length > 0
	);
}

function parseMemberships(value: unknown): AccountWg[] | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const wgs = Reflect.get(value, 'wgs');
	if (!Array.isArray(wgs) || !wgs.every(isAccountWg)) return null;
	return wgs.map((wg) => ({ ...wg, code: normalizeShareCode(wg.code), name: wg.name.trim() }));
}

function moduleFor(slug: string | undefined): PublicModule | null {
	return PUBLIC_MODULES.find((item) => item.slug === slug) ?? null;
}

function withInvitation(path: string, code: string): string {
	return `${path}?code=${encodeURIComponent(code)}`;
}

export function PublicApp(props: { activeModule?: string }) {
	return (
		<Suspense fallback={<div className="min-h-svh bg-[var(--bg-base)]" aria-busy="true" />}>
			<PublicAppContent {...props} />
		</Suspense>
	);
}

function PublicAppContent({ activeModule }: { activeModule?: string }) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [memberships, setMemberships] = useState<AccountWg[]>([]);
	const [membershipState, setMembershipState] = useState<
		'loading' | 'signed-out' | 'authenticated-empty' | 'member-list' | 'error'
	>('loading');
	const [retryNonce, setRetryNonce] = useState(0);
	const module = moduleFor(activeModule);
	const inviteCode = useMemo(() => {
		const code = normalizeShareCode(searchParams.get('code') ?? '');
		return isValidShareCode(code) ? code : '';
	}, [searchParams]);
	const publicHref = (path: string): string =>
		inviteCode ? withInvitation(path, inviteCode) : path;

	// biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce deliberately reruns the lookup without affecting its request shape.
	useEffect(() => {
		const controller = new AbortController();
		setMembershipState('loading');
		fetch('/api/wg/mine', { cache: 'no-store', signal: controller.signal })
			.then(async (response) => {
				if (response.status === 401) {
					setMemberships([]);
					setMembershipState('signed-out');
					return;
				}
				if (!response.ok) throw new Error('membership_lookup_failed');
				const parsed = parseMemberships(await response.json());
				if (!parsed) throw new Error('membership_response_invalid');
				setMemberships(parsed);
				setMembershipState(parsed.length === 0 ? 'authenticated-empty' : 'member-list');
			})
			.catch((error: unknown) => {
				if (error instanceof DOMException && error.name === 'AbortError') return;
				setMembershipState('error');
			});
		return () => controller.abort();
	}, [retryNonce]);

	useEffect(() => {
		if (module || inviteCode || membershipState !== 'member-list' || memberships.length !== 1)
			return;
		const membership = memberships[0];
		if (!membership) return;
		router.replace(`/wg/${encodeURIComponent(membership.code)}`);
	}, [inviteCode, memberships, membershipState, module, router]);

	return (
		<div
			className="min-h-svh bg-[var(--bg-base)]"
			style={{ paddingBottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }}
		>
			<main
				id="main"
				tabIndex={-1}
				className="app-page-enter mx-auto w-full max-w-4xl px-4 py-6 focus:outline-none sm:px-6 sm:py-8"
			>
				<header className="mb-6 flex items-start gap-3">
					<LogoMark size={32} radius={8} className="shrink-0 rounded-lg" />
					<div className="min-w-0">
						<p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-3)]">
							ManaWG
						</p>
						<h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight text-[var(--text-1)]">
							{module?.title ?? 'Dein WG-Dashboard'}
						</h1>
						<p className="mt-1 text-sm text-[var(--text-2)]">
							{module?.description ?? 'Gemeinsam wohnen, einfacher organisiert.'}
						</p>
					</div>
				</header>

				{membershipState === 'error' && (
					<div className="mb-4 space-y-2">
						<ErrorBox>Deine WGs konnten gerade nicht geladen werden.</ErrorBox>
						<button
							type="button"
							onClick={() => setRetryNonce((value) => value + 1)}
							className="min-h-11 rounded-md border border-[var(--border)] px-3 text-[13px] font-medium text-[var(--text-1)] hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
						>
							erneut prüfen
						</button>
					</div>
				)}

				{membershipState === 'member-list' && memberships.length > 1 && !inviteCode && (
					<section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
						<h2 className="text-sm font-semibold text-[var(--text-1)]">Deine WGs</h2>
						<div className="mt-3 grid gap-2">
							{memberships.map((membership) => (
								<Link
									key={membership.id}
									href={`/wg/${encodeURIComponent(membership.code)}`}
									className="flex min-h-11 items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-1)] hover:bg-[var(--bg-base)]"
								>
									{membership.name}
									<span aria-hidden>→</span>
								</Link>
							))}
						</div>
					</section>
				)}

				{inviteCode ? (
					<WgWelcome variant="invitation" code={inviteCode} />
				) : (
					<WgWelcome variant="create" />
				)}

				{module ? (
					<section
						className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
						aria-labelledby="empty-heading"
					>
						<h2 id="empty-heading" className="text-lg font-semibold text-[var(--text-1)]">
							{module.title}
						</h2>
						<p className="mt-2 text-sm leading-relaxed text-[var(--text-2)]">
							Diese öffentliche Ansicht ist read-only. Erstelle eine WG, bevor du hier etwas
							speicherst.
						</p>
						<Link
							href={inviteCode ? withInvitation('/neu', inviteCode) : '/neu?action=create'}
							className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[var(--text-1)] px-4 py-3 text-sm font-semibold text-[var(--bg-base)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							{inviteCode ? 'Dieser WG beitreten' : 'WG erstellen'}
						</Link>
						<Link
							href={publicHref('/')}
							className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-[var(--border)] px-4 py-3 text-sm font-medium text-[var(--text-1)] hover:bg-[var(--bg-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							Zurück zum Dashboard
						</Link>
					</section>
				) : (
					<section
						className="mt-4 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2"
						aria-labelledby="modules-heading"
					>
						<h2 id="modules-heading" className="sr-only">
							Module
						</h2>
						{PRIMARY_MODULES.map(({ slug, title, description, Icon }) => (
							<ModuleCard
								key={slug}
								href={publicHref(`/entdecken/${slug}`)}
								Icon={Icon}
								title={title}
								primary="Leer"
								secondary={description}
							/>
						))}
					</section>
				)}

				<section
					className="mt-8 border-t border-[var(--border)] pt-5"
					aria-labelledby="other-modules-heading"
				>
					<h2 id="other-modules-heading" className="text-sm font-semibold text-[var(--text-1)]">
						Weitere Bereiche
					</h2>
					<div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
						{OTHER_MODULES.map(({ slug, title }) => (
							<Link
								key={slug}
								href={publicHref(`/entdecken/${slug}`)}
								className="text-[13px] text-[var(--text-2)] underline-offset-4 hover:text-[var(--text-1)] hover:underline"
							>
								{title}
							</Link>
						))}
					</div>
				</section>
			</main>
			<nav
				aria-label="Öffentliche Hauptnavigation"
				className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[var(--app-frame-width)] border-t border-[var(--border)] bg-[var(--bg-base)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg-base)]/85"
			>
				<ul
					className="mx-auto flex max-w-2xl [&>li]:min-w-0 [&>li]:flex-1"
					style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
				>
					<NavItem href={publicHref('/')} label="Start" iconKey="home" />
					{PRIMARY_MODULES.map(({ slug, title }) => (
						<NavItem
							key={slug}
							href={publicHref(`/entdecken/${slug}`)}
							label={title}
							iconKey={slug as 'ausgaben' | 'einkauf' | 'pinnwand' | 'putzen'}
						/>
					))}
				</ul>
			</nav>
		</div>
	);
}
