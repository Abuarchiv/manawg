'use client';

import { AppBottomNav } from '@/components/app/AppBottomNav';
import { ErrorBox } from '@/components/app/ErrorBox';
import { RouteFocusOnNavigate } from '@/components/app/RouteFocusOnNavigate';
import {
	HOME_NAV_LABEL,
	WG_SECTIONS,
	isActivePage,
	moduleSlugOf,
} from '@/components/app/navigation';
import { LegalLinks } from '@/components/entry/LegalLinks';
import { type AccountWg, MembershipCard } from '@/components/entry/MembershipCard';
import {
	PublicModulePreview,
	PublicModulePreviews,
	type PublicPreviewModule,
} from '@/components/entry/PublicModulePreview';
import { SignOutActions } from '@/components/entry/SignOutActions';
import { InvitationNotice, WgWelcome } from '@/components/entry/WgWelcome';
import {
	PRIMARY_MODULE_SLUGS,
	type PublicModuleSlug,
	isPublicModuleSlug,
} from '@/components/entry/public-modules';
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
import { useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';
import {
	CalendarDays,
	Clock3,
	ListChecks,
	type LucideIcon,
	Megaphone,
	MessageCircle,
	Package,
	Receipt,
	Repeat2,
	Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

const MODULE_ICONS: Record<PublicModuleSlug, LucideIcon> = {
	ausgaben: Receipt,
	einkauf: ListChecks,
	pinnwand: Megaphone,
	putzen: Sparkles,
	fixkosten: Repeat2,
	mahnungen: Receipt,
	vorraete: Package,
	kalender: CalendarDays,
	aktivitaet: Clock3,
	chat: MessageCircle,
};

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
	const t = useTranslations('entry');
	const tm = useTranslations('entry.modules');
	const message = useMessage();
	const router = useRouter();
	const searchParams = useSearchParams();
	const accountDeletionPending = searchParams.get('accountDeletion') === 'pending';
	const leftWg = searchParams.get('left') === '1';
	const deletedWg = searchParams.get('deleted') === '1';
	const [memberships, setMemberships] = useState<AccountWg[]>([]);
	const [membershipState, setMembershipState] = useState<
		'loading' | 'signed-out' | 'authenticated-empty' | 'member-list' | 'error'
	>('loading');
	const [retryNonce, setRetryNonce] = useState(0);
	// Keeps the retry button mounted (and focused) while the lookup reruns.
	const [retried, setRetried] = useState(false);
	// Client-only: set once a session cookie exists, so guests never see a skeleton flash.
	const [sessionPending, setSessionPending] = useState(false);
	const toModule = (slug: PublicModuleSlug): PublicPreviewModule => ({
		slug,
		title: tm(`${slug}.title`),
		Icon: MODULE_ICONS[slug],
	});
	const primaryModules = PRIMARY_MODULE_SLUGS.map(toModule);
	const module = activeModule && isPublicModuleSlug(activeModule) ? toModule(activeModule) : null;
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
					label: singleWg ? t('membership.open') : t('membership.title'),
				}
			: membershipState === 'authenticated-empty'
				? inviteToken
					? { href: invitePath(inviteToken), label: t('welcome.acceptInvite') }
					: { href: '/neu?action=create', label: t('welcome.createFlat') }
				: { href: publicHref('/neu'), label: t('public.signIn') };

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

	// After leaving or deleting a WG the notice stays readable instead of jumping into the other WG.
	const showsExitNotice = leftWg || deletedWg;
	useEffect(() => {
		if (
			module ||
			inviteToken ||
			showsExitNotice ||
			membershipState !== 'member-list' ||
			memberships.length !== 1
		)
			return;
		const membership = memberships[0];
		if (!membership) return;
		router.replace(`/wg/${encodeURIComponent(membership.code)}`);
	}, [inviteToken, memberships, membershipState, module, router, showsExitNotice]);

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
								aria-label={t('frame.home')}
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
							<AlertTitle>{t('public.accountDeletion.title')}</AlertTitle>
							<AlertDescription className="text-foreground">
								{t('public.accountDeletion.body')}
							</AlertDescription>
						</Alert>
					)}
					{deletedWg && (
						<Alert>
							<AlertTitle>{t('public.flatDeleted.title')}</AlertTitle>
							<AlertDescription className="text-foreground">
								{t('public.flatDeleted.body')}
							</AlertDescription>
						</Alert>
					)}
					{leftWg && (
						<Alert>
							<AlertTitle>{t('public.leftFlat.title')}</AlertTitle>
							<AlertDescription className="text-foreground">
								{t('public.leftFlat.body')}
							</AlertDescription>
						</Alert>
					)}
					{section && (
						<SubNav
							label={t('public.discover', { section: message({ key: section.label }) })}
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
							aria-label={t('public.checking')}
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
								!multi && <PublicModulePreviews modules={primaryModules} hrefFor={discoveryHref} />
							)}
							{legacyCode && <ErrorBox>{message(LEGACY_CODE_MESSAGE)}</ErrorBox>}
							{badInvite && <ErrorBox>{t('errors.badInvite')}</ErrorBox>}
							{inviteToken ? (
								<WgWelcome variant="invitation" token={inviteToken} guest={guest} />
							) : (
								membershipState !== 'member-list' && <WgWelcome variant="create" guest={guest} />
							)}
						</>
					)}
					{checkingSession && module && (
						<output aria-live="polite" aria-label={t('public.checking')} className="block">
							<Skeleton className="h-11 w-full" />
						</output>
					)}
					{(membershipState === 'error' || (retried && membershipState === 'loading')) && (
						<div className="flex flex-col gap-2">
							<ErrorBox>{t('public.loadFailed')}</ErrorBox>
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
								{retried ? t('public.rechecking') : t('public.recheck')}
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
			<AppBottomNav label={t('public.nav')}>
				<NavItem
					href={publicHref('/')}
					label={HOME_NAV_LABEL}
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
