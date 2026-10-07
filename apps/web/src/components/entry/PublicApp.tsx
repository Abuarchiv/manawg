'use client';

import { AppBottomNav } from '@/components/app/AppBottomNav';
import { ErrorBox } from '@/components/app/ErrorBox';
import { WG_SECTIONS } from '@/components/app/navigation';
import { LegalLinks } from '@/components/entry/LegalLinks';
import {
	PublicModulePreview,
	PublicModulePreviews,
	type PublicPreviewModule,
} from '@/components/entry/PublicModulePreview';
import { InvitationNotice, WgWelcome } from '@/components/entry/WgWelcome';
import { LogoMark } from '@/components/ui/LogoMark';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { NavItem } from '@/components/wg/NavItem';
import { SubNav } from '@/components/wg/SubNav';
import { AccountDeleteSection } from '@/components/wg/einstellungen/AccountDeleteSection';
import { hasSessionCookie } from '@/core/auth/session-hint';
import { REQUEST_TIMEOUT_MS, anySignal } from '@/core/infra/api-client';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
import { cn } from '@/shared/lib/cn';
import {
	CalendarDays,
	ChevronRight,
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
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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

// PublicApp remounts on every public route, so the previous path has to outlive it.
let lastPublicPath: string | null = null;

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

function MembershipCard({ memberships }: { memberships: AccountWg[] }) {
	return (
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
						// biome-ignore lint/a11y/useSemanticElements: ItemGroup is a div[role=list], a bare <li> would be invalid HTML
						<div key={membership.id} role="listitem" className="w-full min-w-0">
							<Item
								variant="outline"
								render={<Link href={`/wg/${encodeURIComponent(membership.code)}`} />}
							>
								<ItemContent className="min-w-0">
									<ItemTitle className="line-clamp-none break-words">{membership.name}</ItemTitle>
									<ItemDescription>WG öffnen</ItemDescription>
								</ItemContent>
								<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
							</Item>
						</div>
					))}
				</ItemGroup>
			</CardContent>
		</Card>
	);
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
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const accountDeletionPending = searchParams.get('accountDeletion') === 'pending';
	const [memberships, setMemberships] = useState<AccountWg[]>([]);
	const [membershipState, setMembershipState] = useState<
		'loading' | 'signed-out' | 'authenticated-empty' | 'member-list' | 'error'
	>('loading');
	const [retryNonce, setRetryNonce] = useState(0);
	// Keeps the retry button mounted (and focused) while the lookup reruns.
	const [retried, setRetried] = useState(false);
	// Client-only: set once a session cookie exists, so guests never see a skeleton flash.
	const [sessionPending, setSessionPending] = useState(false);
	const module = moduleFor(activeModule);
	const rawCode = (searchParams.get('code') ?? '').trim();
	const inviteCode = useMemo(() => {
		const code = normalizeShareCode(rawCode);
		return isValidShareCode(code) ? code : '';
	}, [rawCode]);
	const badInvite = rawCode !== '' && inviteCode === '';
	const publicHref = (path: string): string =>
		inviteCode ? withInvitation(path, inviteCode) : path;
	const singleWg =
		membershipState === 'member-list' && memberships.length === 1 ? memberships[0] : null;
	const checkingSession = sessionPending && membershipState === 'loading';
	const multi = membershipState === 'member-list' && memberships.length > 1 && !inviteCode;
	const accountAction =
		membershipState === 'member-list'
			? {
					href: singleWg ? `/wg/${encodeURIComponent(singleWg.code)}` : '/',
					label: singleWg ? 'WG öffnen' : 'Deine WGs',
				}
			: membershipState === 'authenticated-empty'
				? inviteCode
					? { href: publicHref('/neu'), label: 'Einladung annehmen' }
					: { href: '/neu?action=create', label: 'WG erstellen' }
				: { href: publicHref('/neu'), label: 'Anmelden' };

	// Client navigation between public pages: land on #main like the WG shell does.
	useEffect(() => {
		const previous = lastPublicPath;
		lastPublicPath = pathname;
		if (previous === null || previous === pathname) return;
		const main = document.getElementById('main');
		if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
	}, [pathname]);

	useEffect(() => {
		if (membershipState !== 'loading') setRetried(false);
	}, [membershipState]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce deliberately reruns the lookup without affecting its request shape.
	useEffect(() => {
		const controller = new AbortController();
		if (!hasSessionCookie()) {
			setMemberships([]);
			setMembershipState('signed-out');
			return;
		}
		setSessionPending(true);
		setMembershipState('loading');
		fetch('/api/wg/mine', {
			cache: 'no-store',
			signal: anySignal([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
		})
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
	// Related pages (Erinnerungen, Import) have no segment of their own, so they keep a visible h1.
	const inSectionPages = section?.pages.some(
		(page) => page.slug === activeModule || (page.slug === 'abos' && activeModule === 'fixkosten'),
	);
	// On the home the list of WGs is already right below the header.
	// The welcome block below already offers the same action for signed-in users without a WG.
	const hideAccountLink = (multi && !module) || membershipState === 'authenticated-empty';
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
			<main
				id="main"
				tabIndex={-1}
				className="flex w-full min-w-0 flex-1 flex-col gap-4 px-4 py-3 focus:outline-none"
			>
				<div className={cn('flex min-w-0 flex-col', section ? 'gap-3' : 'gap-4')}>
					<header className="flex flex-col gap-2">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<Link
								href={publicHref('/')}
								className="flex min-h-9 items-center gap-2"
								aria-label="ManaWG Startseite"
							>
								<LogoMark size={24} tile={false} aria-hidden />
								<span className="font-heading text-xl font-semibold tracking-[-0.03em]">
									ManaWG
								</span>
							</Link>
							{checkingSession ? (
								<Skeleton className="ml-auto h-8 w-20" aria-hidden />
							) : (
								!hideAccountLink && (
									<Link
										href={accountAction.href}
										className={cn(
											buttonVariants({ variant: 'link' }),
											'ml-auto px-0 text-muted-foreground',
										)}
									>
										{accountAction.label}
									</Link>
								)
							)}
						</div>
						<h1
							className={cn(
								'font-heading text-balance text-lg leading-6 font-semibold tracking-tight',
								(inSectionPages || !module) && 'sr-only',
							)}
						>
							{module?.title ?? 'ManaWG'}
						</h1>
					</header>
					{accountDeletionPending && (
						<Alert>
							<AlertTitle>Konto wird gelöscht</AlertTitle>
							<AlertDescription className="text-foreground">
								ManaWG hat deine Zugänge zu allen WGs entfernt. Die Löschung beim Anmeldedienst
								steht noch aus und wird automatisch erneut versucht.
							</AlertDescription>
						</Alert>
					)}
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
					{checkingSession && !module ? (
						<output
							aria-live="polite"
							aria-label="Deine WGs werden geprüft"
							className="flex flex-col gap-4"
						>
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-48 w-full" />
						</output>
					) : (
						<>
							{inviteCode && <InvitationNotice code={inviteCode} />}
							{multi && <MembershipCard memberships={memberships} />}
							{module ? (
								<PublicModulePreview module={module} />
							) : (
								!multi && <PublicModulePreviews modules={PRIMARY_MODULES} hrefFor={discoveryHref} />
							)}
							{badInvite && (
								<ErrorBox>
									Dieser Einladungslink ist unvollständig oder ungültig. Frag die WG nach einem
									neuen Link.
								</ErrorBox>
							)}
							{inviteCode ? (
								<WgWelcome variant="invitation" code={inviteCode} />
							) : (
								membershipState !== 'member-list' && <WgWelcome variant="create" />
							)}
						</>
					)}
					{checkingSession && module && (
						<output aria-live="polite" aria-label="Deine WGs werden geprüft" className="block">
							<Skeleton className="h-11 w-full" />
						</output>
					)}
					{(membershipState === 'error' || (retried && membershipState === 'loading')) && (
						<div className="flex flex-col gap-2">
							<ErrorBox>Deine WGs konnten gerade nicht geladen werden.</ErrorBox>
							<Button
								type="button"
								variant="outline"
								focusableWhenDisabled
								disabled={retried}
								aria-busy={retried}
								className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
								onClick={() => {
									setRetried(true);
									setRetryNonce((value) => value + 1);
								}}
							>
								{retried && <Spinner data-icon="inline-start" aria-hidden />}
								{retried ? 'Prüfe …' : 'Erneut prüfen'}
							</Button>
						</div>
					)}
					{/* Signed-in users without a WG never reach WG settings, so offer deletion here. */}
					{membershipState === 'authenticated-empty' && (
						<div className="mt-4">
							<AccountDeleteSection />
						</div>
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
