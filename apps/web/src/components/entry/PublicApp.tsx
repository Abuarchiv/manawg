'use client';

import { AppBottomNav } from '@/components/app/AppBottomNav';
import { RouteFocusOnNavigate } from '@/components/app/RouteFocusOnNavigate';
import { WG_SECTIONS } from '@/components/app/navigation';
import { LegalLinks } from '@/components/entry/LegalLinks';
import {
	PublicModulePreview,
	PublicModulePreviews,
	type PublicPreviewModule,
} from '@/components/entry/PublicModulePreview';
import { WgWelcome } from '@/components/entry/WgWelcome';
import { ErrorBox } from '@/components/neu/ErrorBox';
import { AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { NavItem } from '@/components/wg/NavItem';
import { SubNav } from '@/components/wg/SubNav';
import { AccountDeleteSection } from '@/components/wg/einstellungen/AccountDeleteSection';
import { hasSessionCookie } from '@/core/auth/session-hint';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
import { LogoMark } from '@/shared/components/ui/LogoMark';
import { cn } from '@/shared/lib/cn';
import {
	CalendarDays,
	Clock3,
	ListChecks,
	Megaphone,
	MessageCircle,
	Package,
	Receipt,
	Repeat2,
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

type PublicModule = PublicPreviewModule;

const PRIMARY_MODULES: PublicModule[] = [
	{ slug: 'ausgaben', title: 'Ausgaben', Icon: Receipt },
	{ slug: 'einkauf', title: 'Einkäufe', Icon: ListChecks },
	{ slug: 'pinnwand', title: 'Pinnwand', Icon: Megaphone },
	{ slug: 'putzen', title: 'Putzplan', Icon: Sparkles },
];

const OTHER_MODULES: PublicModule[] = [
	{ slug: 'fixkosten', title: 'Fixkosten', Icon: Repeat2 },
	{ slug: 'mahnungen', title: 'Erinnerungen', Icon: Receipt },
	{ slug: 'vorraete', title: 'Vorräte', Icon: Package },
	{ slug: 'kalender', title: 'Kalender', Icon: CalendarDays },
	{ slug: 'aktivitaet', title: 'Aktivität', Icon: Clock3 },
	{ slug: 'chat', title: 'Chat', Icon: MessageCircle },
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
	const accountDeletionPending = searchParams.get('accountDeletion') === 'pending';
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
	const singleWg =
		membershipState === 'member-list' && memberships.length === 1 ? memberships[0] : null;
	const accountAction =
		membershipState === 'member-list'
			? {
					href: singleWg ? `/wg/${encodeURIComponent(singleWg.code)}` : '/',
					label: singleWg ? 'WG öffnen' : 'Deine WGs',
				}
			: membershipState === 'authenticated-empty'
				? inviteCode
					? { href: publicHref('/neu'), label: 'Dieser WG beitreten' }
					: { href: '/neu?action=create', label: 'WG erstellen' }
				: { href: publicHref('/neu'), label: 'Anmelden' };

	// biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce deliberately reruns the lookup without affecting its request shape.
	useEffect(() => {
		const controller = new AbortController();
		if (!hasSessionCookie()) {
			setMemberships([]);
			setMembershipState('signed-out');
			return;
		}
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

	const section = WG_SECTIONS.find(
		(item) =>
			item.pages.some(
				(page) =>
					page.slug === activeModule || (page.slug === 'abos' && activeModule === 'fixkosten'),
			) || item.related.some((slug) => slug === activeModule),
	);
	const discoveryHref = (slug: string) =>
		publicHref(`/entdecken/${slug === 'abos' ? 'fixkosten' : slug}`);

	return (
		<div
			className="flex min-h-svh flex-col bg-background"
			style={{
				paddingTop: 'env(safe-area-inset-top, 0px)',
				paddingBottom: 'calc(var(--app-nav-height, 5rem) + 0.5rem)',
			}}
		>
			<RouteFocusOnNavigate />
			<main
				id="main"
				tabIndex={-1}
				className="flex w-full min-w-0 flex-1 flex-col gap-6 px-4 py-5 focus:outline-none"
			>
				{accountDeletionPending && (
					<output
						aria-live="polite"
						className="block w-full min-w-0 rounded-lg border border-border bg-card px-2.5 py-2 text-sm text-card-foreground"
					>
						<AlertDescription>
							ManaWG hat deine Zugänge zu allen WGs entfernt. Die Löschung beim Anmeldedienst steht
							noch aus und wird automatisch erneut versucht.
						</AlertDescription>
					</output>
				)}
				<div className={cn('flex min-w-0 flex-col', section ? 'gap-3' : 'gap-6')}>
					<header className="flex flex-col gap-3">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<Link
								href={publicHref('/')}
								className="flex min-h-11 items-center gap-2"
								aria-label="ManaWG Startseite"
							>
								<LogoMark size={24} tile={false} aria-hidden />
								<span className="font-heading text-xl font-semibold tracking-[-0.03em]">
									ManaWG
								</span>
							</Link>
							<Link
								href={accountAction.href}
								className={cn(
									buttonVariants({ variant: 'link' }),
									'ml-auto px-0 text-muted-foreground',
								)}
							>
								{accountAction.label}
							</Link>
						</div>
						<h1
							className={cn(
								'font-heading text-balance text-lg leading-6 font-semibold tracking-tight',
								(section || !module) && 'sr-only',
							)}
						>
							{module?.title ?? 'ManaWG'}
						</h1>
					</header>
					{section && (
						<SubNav
							label={`${section.label} – entdecken`}
							items={section.pages.map((page) => ({
								href: discoveryHref(page.slug),
								label: page.label,
								icon: page.icon,
							}))}
						/>
					)}
					{module ? (
						<PublicModulePreview module={module} />
					) : (
						<PublicModulePreviews modules={PRIMARY_MODULES} hrefFor={discoveryHref} />
					)}
					{inviteCode ? (
						<WgWelcome variant="invitation" code={inviteCode} />
					) : (
						<WgWelcome variant="create" />
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
							>
								Erneut prüfen
							</Button>
						</div>
					)}
					{/* Signed-in users without a WG never reach WG settings, so offer deletion here. */}
					{membershipState === 'authenticated-empty' && <AccountDeleteSection />}
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
				</div>
				<LegalLinks className="mt-auto" />
			</main>
			<AppBottomNav label="Öffentliche Hauptnavigation">
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
						activePrefixes={[...item.pages.map((page) => page.slug), ...item.related].map(
							discoveryHref,
						)}
					/>
				))}
			</AppBottomNav>
		</div>
	);
}
