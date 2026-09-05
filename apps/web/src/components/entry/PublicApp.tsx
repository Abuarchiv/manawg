'use client';

import { WG_SECTIONS } from '@/components/app/navigation';
import { WgWelcome } from '@/components/entry/WgWelcome';
import { ErrorBox } from '@/components/neu/ErrorBox';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { NavItem } from '@/components/wg/NavItem';
import { SubNav } from '@/components/wg/SubNav';
import { LogoMark } from '@/shared/components/ui/LogoMark';
import { cn } from '@/shared/lib/cn';
import { isValidShareCode, normalizeShareCode } from '@/shared/lib/share-code';
import {
	CalendarDays,
	Clock3,
	ListChecks,
	type LucideIcon,
	Megaphone,
	MessageCircle,
	Package,
	Receipt,
	Settings,
	Sparkles,
} from 'lucide-react';
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
	{ slug: 'vorraete', title: 'Vorräte', description: 'Was noch da ist.', Icon: Package },
	{ slug: 'kalender', title: 'Termine', description: 'Gemeinsame Termine.', Icon: CalendarDays },
	{
		slug: 'aktivitaet',
		title: 'Aktivität',
		description: 'Was zuletzt passiert ist.',
		Icon: Clock3,
	},
	{ slug: 'chat', title: 'Chat', description: 'Kurz etwas klären.', Icon: MessageCircle },
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
		<Suspense
			fallback={
				<div className="flex min-h-svh flex-col gap-4 bg-background p-4" aria-busy="true">
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-48 w-full" />
				</div>
			}
		>
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

	const section = WG_SECTIONS.find((item) =>
		item.pages.some(
			(page) =>
				page.slug === activeModule || (page.slug === 'abos' && activeModule === 'fixkosten'),
		),
	);
	const discoveryHref = (slug: string) =>
		publicHref(`/entdecken/${slug === 'abos' ? 'fixkosten' : slug}`);

	return (
		<div
			className="min-h-svh bg-background"
			style={{
				paddingTop: 'env(safe-area-inset-top, 0px)',
				paddingBottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))',
			}}
		>
			<main
				id="main"
				tabIndex={-1}
				className="flex w-full min-w-0 flex-col gap-6 px-4 py-5 focus:outline-none"
			>
				<header className="flex flex-col gap-3">
					<div className="flex items-center gap-2">
						<LogoMark size={28} radius={7} />
						<span className="text-sm font-medium">ManaWG</span>
					</div>
					<div className="flex flex-col gap-1">
						<h1 className="text-2xl font-semibold tracking-tight">
							{module?.title ?? 'Alles für eure WG'}
						</h1>
						<p className="text-sm text-muted-foreground">
							{module?.description ?? 'Einkauf, gemeinsame Kosten und Alltag an einem Ort.'}
						</p>
					</div>
				</header>
				{section && (
					<SubNav
						label={`${section.label} – entdecken`}
						items={section.pages
							.filter((page) => page.slug !== 'import')
							.map((page) => ({
								href: discoveryHref(page.slug),
								label: page.label,
								icon: page.icon,
							}))}
					/>
				)}
				{membershipState === 'loading' && (
					<output aria-live="polite" aria-label="Deine WGs werden geprüft" className="block">
						<Skeleton className="h-11 w-full" />
					</output>
				)}
				{membershipState === 'error' && (
					<div className="flex flex-col gap-2">
						<ErrorBox>Deine WGs konnten gerade nicht geladen werden.</ErrorBox>
						<Button
							type="button"
							variant="outline"
							onClick={() => setRetryNonce((value) => value + 1)}
							className="min-h-11"
						>
							erneut prüfen
						</Button>
					</div>
				)}
				{membershipState === 'member-list' && memberships.length > 1 && !inviteCode && (
					<Card>
						<CardHeader>
							<CardTitle>
								<h2>Deine WGs</h2>
							</CardTitle>
							<CardDescription>Wo möchtest du weitermachen?</CardDescription>
						</CardHeader>
						<CardContent>
							<ItemGroup>
								{memberships.map((membership) => (
									<Item
										key={membership.id}
										variant="outline"
										render={<Link href={`/wg/${encodeURIComponent(membership.code)}`} />}
									>
										<ItemContent className="min-w-0">
											<ItemTitle className="line-clamp-none break-words">
												{membership.name}
											</ItemTitle>
											<ItemDescription>WG öffnen</ItemDescription>
										</ItemContent>
									</Item>
								))}
							</ItemGroup>
						</CardContent>
					</Card>
				)}
				{inviteCode ? (
					<WgWelcome variant="invitation" code={inviteCode} />
				) : (
					<WgWelcome variant="create" />
				)}
				{module ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<module.Icon aria-hidden />
							</EmptyMedia>
							<EmptyTitle>Noch keine WG verbunden</EmptyTitle>
							<EmptyDescription>
								Hier siehst du später{' '}
								{module.title === 'Einstellungen'
									? 'die Einstellungen deiner WG'
									: 'die Einträge deiner WG'}
								. Die öffentliche Ansicht zeigt keine privaten Inhalte.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Link
								href={inviteCode ? withInvitation('/neu', inviteCode) : '/neu'}
								className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 w-full')}
							>
								{inviteCode ? 'Mit Einladung anmelden' : 'Anmelden und WG wählen'}
							</Link>
							<Link
								href={publicHref('/')}
								className={cn(buttonVariants({ variant: 'link' }), 'min-h-11')}
							>
								Zurück zu Start
							</Link>
						</EmptyContent>
					</Empty>
				) : (
					<section aria-labelledby="modules-heading" className="flex flex-col gap-3">
						<h2 id="modules-heading" className="text-base font-semibold">
							Bereiche entdecken
						</h2>
						<ItemGroup>
							{PRIMARY_MODULES.map(({ slug, title, description, Icon }) => (
								<Item key={slug} variant="outline" render={<Link href={discoveryHref(slug)} />}>
									<ItemMedia variant="icon">
										<Icon aria-hidden />
									</ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle>{title}</ItemTitle>
										<ItemDescription>{description}</ItemDescription>
									</ItemContent>
								</Item>
							))}
						</ItemGroup>
					</section>
				)}
				<section aria-labelledby="other-modules-heading" className="flex flex-col gap-3">
					<h2 id="other-modules-heading" className="text-base font-semibold">
						Weitere Bereiche
					</h2>
					<ItemGroup>
						{OTHER_MODULES.filter((item) => item.slug !== activeModule).map(
							({ slug, title, description, Icon }) => (
								<Item key={slug} size="sm" render={<Link href={discoveryHref(slug)} />}>
									<ItemMedia variant="icon">
										<Icon aria-hidden />
									</ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle>{title}</ItemTitle>
										<ItemDescription>{description}</ItemDescription>
									</ItemContent>
								</Item>
							),
						)}
					</ItemGroup>
				</section>
				<Link
					href="/datenschutz"
					className={cn(buttonVariants({ variant: 'link' }), 'min-h-11 self-start px-0')}
				>
					Datenschutz
				</Link>
			</main>
			<nav
				aria-label="Öffentliche Hauptnavigation"
				data-app-chrome
				className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[var(--app-frame-width)] border-t border-border bg-background/95 backdrop-blur"
			>
				<ul
					className="flex gap-1 px-2 pt-1 [&>li]:min-w-0 [&>li]:flex-1"
					style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
				>
					<NavItem
						href={publicHref('/')}
						label="Start"
						iconKey="home"
						activePrefixes={[discoveryHref('aktivitaet')]}
					/>
					{WG_SECTIONS.map((item) => (
						<NavItem
							key={item.label}
							href={discoveryHref(item.pages[0].slug)}
							label={item.label}
							iconKey={item.iconKey}
							activePrefixes={item.pages.map((page) => discoveryHref(page.slug))}
						/>
					))}
				</ul>
			</nav>
		</div>
	);
}
