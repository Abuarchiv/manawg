'use client';

import { AppBottomNav } from '@/components/app/AppBottomNav';
import { ErrorBox } from '@/components/app/ErrorBox';
import { RouteFocusOnNavigate } from '@/components/app/RouteFocusOnNavigate';
import { WG_SECTIONS, isActivePage, moduleSlugOf } from '@/components/app/navigation';
import { LegalLinks } from '@/components/entry/LegalLinks';
import { type AccountWg, MembershipCard } from '@/components/entry/MembershipCard';
import {
	PublicModulePreview,
	PublicModulePreviews,
	type PublicPreviewModule,
} from '@/components/entry/PublicModulePreview';
import { SignOutActions } from '@/components/entry/SignOutActions';
import { InvitationNotice, WgWelcome } from '@/components/entry/WgWelcome';
import { LogoMark } from '@/components/ui/LogoMark';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { NavItem } from '@/components/wg/NavItem';
import { SubNav } from '@/components/wg/SubNav';
import { hasSessionCookie } from '@/core/auth/session-hint';
import { fetchAccountWgs } from '@/core/infra/account-wgs';
import { LEGACY_CODE_MESSAGE } from '@/core/infra/join-flow';
import { invitePath, isInviteToken } from '@/core/utils/invite-token';
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
import { Suspense, useEffect, useState } from 'react';

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

function moduleFor(slug: string | undefined): PublicModule | null {
	return PUBLIC_MODULES.find((item) => item.slug === slug) ?? null;
}

function withInvitation(path: string, token: string): string {
	return `${path}?invite=${encodeURIComponent(token)}`;
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
	const leftWg = searchParams.get('left') === '1';
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
	const rawInvite = (searchParams.get('invite') ?? '').trim();
	const inviteToken = isInviteToken(rawInvite) ? rawInvite : '';
	const badInvite = rawInvite !== '' && inviteToken === '';
	// A `?code=` link is a dead end: the share code is only the WG's address.
	const legacyCode = (searchParams.get('code') ?? '').trim() !== '' && inviteToken === '';
	const publicHref = (path: string): string =>
		inviteToken ? withInvitation(path, inviteToken) : path;
	const singleWg =
		membershipState === 'member-list' && memberships.length === 1 ? memberships[0] : null;
	const checkingSession = sessionPending && membershipState === 'loading';
	const guest =
		membershipState === 'signed-out' || (membershipState === 'loading' && !sessionPending);
	const multi = membershipState === 'member-list' && memberships.length > 1 && !inviteToken;
	const accountAction =
		membershipState === 'member-list'
			? {
					href: singleWg ? `/wg/${encodeURIComponent(singleWg.code)}` : '/',
					label: singleWg ? 'WG öffnen' : 'Deine WGs',
				}
			: membershipState === 'authenticated-empty'
				? inviteToken
					? { href: invitePath(inviteToken), label: 'Einladung annehmen' }
					: { href: '/neu?action=create', label: 'WG erstellen' }
				: { href: publicHref('/neu'), label: 'Anmelden' };

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
		fetchAccountWgs(controller.signal).then((result) => {
			if (controller.signal.aborted) return;
			if (!result.ok) {
				if (result.status === 401) {
					setMemberships([]);
					setMembershipState('signed-out');
				} else {
					setMembershipState('error');
				}
				return;
			}
			setMemberships(result.wgs);
			setMembershipState(result.wgs.length === 0 ? 'authenticated-empty' : 'member-list');
		});
		return () => controller.abort();
	}, [retryNonce]);

	useEffect(() => {
		if (module || inviteToken || membershipState !== 'member-list' || memberships.length !== 1)
			return;
		const membership = memberships[0];
		if (!membership) return;
		router.replace(`/wg/${encodeURIComponent(membership.code)}`);
	}, [inviteToken, memberships, membershipState, module, router]);

	const section = WG_SECTIONS.find(
		(item) =>
			item.pages.some((page) => isActivePage(page.slug, activeModule)) ||
			item.related.some((slug) => slug === activeModule),
	);
	// Related pages (Erinnerungen, Import) have no segment of their own, so they keep a visible h1.
	const inSectionPages = section?.pages.some((page) => isActivePage(page.slug, activeModule));
	// On the home the list of WGs is already right below the header.
	// The welcome block below already offers the same action for signed-in users without a WG.
	const hideAccountLink = (multi && !module) || membershipState === 'authenticated-empty';
	const discoveryHref = (slug: string) => publicHref(`/entdecken/${moduleSlugOf(slug)}`);

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
					{leftWg && (
						<Alert>
							<AlertTitle>Du hast die WG verlassen</AlertTitle>
							<AlertDescription className="text-foreground">
								Deine Mitgliedschaft wurde beendet. Mit einer Einladung kannst du jederzeit einer WG
								beitreten.
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
							{inviteToken && <InvitationNotice />}
							{multi && <MembershipCard memberships={memberships} />}
							{module ? (
								<PublicModulePreview module={module} />
							) : (
								!multi && <PublicModulePreviews modules={PRIMARY_MODULES} hrefFor={discoveryHref} />
							)}
							{legacyCode && <ErrorBox>{LEGACY_CODE_MESSAGE}</ErrorBox>}
							{badInvite && (
								<ErrorBox>
									Dieser Einladungslink ist unvollständig oder ungültig. Frag die WG nach einem
									neuen Link.
								</ErrorBox>
							)}
							{inviteToken ? (
								<WgWelcome variant="invitation" token={inviteToken} guest={guest} />
							) : (
								membershipState !== 'member-list' && <WgWelcome variant="create" guest={guest} />
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
								{retried ? 'Prüfe…' : 'Erneut prüfen'}
							</Button>
						</div>
					)}
					{membershipState === 'authenticated-empty' && (
						<SignOutActions
							onSignedOut={() => {
								setMemberships([]);
								setMembershipState('signed-out');
							}}
						/>
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
