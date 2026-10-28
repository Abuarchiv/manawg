import { AppBottomNav } from '@/components/app/AppBottomNav';
import { RouteFocusOnNavigate } from '@/components/app/RouteFocusOnNavigate';
import { WgAppHeader } from '@/components/app/WgAppHeader';
import { HOME_NAV_LABEL, WG_SECTIONS } from '@/components/app/navigation';
import { ToastContainer } from '@/components/ui/Toast';
import { NavItem } from '@/components/wg/NavItem';
import { OfflineBanner } from '@/components/wg/OfflineBanner';
import { SessionExpiredBanner } from '@/components/wg/SessionExpiredBanner';
import { WgContextProvider } from '@/components/wg/WgContextProvider';
import type { SessionMember } from '@/core/auth/local-account';
import { REQUEST_PATH_HEADER, wgReturnPath } from '@/core/auth/next-path';
import { loadWgShell, loadWgViewer } from '@/core/guards/load-wg-viewer';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
import { loadFixtureWgView } from '@/fixtures/pages';
import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { TabWarmup } from './_components/TabWarmup';

interface Props {
	children: ReactNode;
	params: Promise<{ code: string }>;
}

// A segment title resets the inherited template, so this layout restates it for the
// feature layouts below. `default` still passes through the root template.
function wgTitle(name: string): Metadata['title'] {
	return { default: name, template: '%s — ManaWG' };
}

export async function generateMetadata({
	params,
}: { params: Promise<{ code: string }> }): Promise<Metadata> {
	const { code: rawCode } = await params;
	const t = await getTranslations('meta.wg');
	const code = normalizeShareCode(rawCode);
	if (!isValidShareCode(code)) {
		return { robots: { index: false, follow: false } };
	}
	const fixture = loadFixtureWgView(code);
	if (fixture) {
		return {
			title: wgTitle(fixture === 'not_found' ? t('fallbackName') : fixture.wg.name),
			robots: { index: false, follow: false },
		};
	}
	const viewer = await loadWgViewer(code);
	return {
		title: wgTitle(viewer?.access ? viewer.access.name : t('fallbackName')),
		robots: { index: false, follow: false },
	};
}

async function requestedPath(): Promise<string | null> {
	return (await headers()).get(REQUEST_PATH_HEADER);
}

async function signInPath(code: string): Promise<string> {
	return `/neu?next=${encodeURIComponent(wgReturnPath(code, await requestedPath()))}`;
}

export default async function WgLayout({ children, params }: Props) {
	const { code: rawCode } = await params;
	const code = normalizeShareCode(rawCode);
	if (!isValidShareCode(code)) {
		notFound();
	}

	const fixture = loadFixtureWgView(code);
	if (fixture === 'not_found') notFound();
	if (fixture) {
		// The first fixture member is the caller, as the fixture API answers. Without authUserId the
		// provider is not server-verified: the member lookup (answered by the fixture API as
		// FIXTURE_AUTH_USER_ID) confirms the account, and the roster is fetched like in the app.
		const [first] = fixture.members;
		return (
			<WgShell
				code={code}
				wg={fixture.wg}
				members={fixture.members}
				{...(first ? { initialIdentity: { memberId: first.id, name: first.name } } : {})}
			>
				{children}
			</WgShell>
		);
	}

	const shell = await loadWgShell(code);
	if (!shell) redirect(await signInPath(code));
	const { user, access, movedOut, members, initialIsAdmin } = shell;
	if (!access) {
		const next = encodeURIComponent(wgReturnPath(code, await requestedPath()));
		// Tell moved-out members why the WG is gone instead of suggesting to join again.
		redirect(`/neu?next=${next}${movedOut ? '&reason=moved_out' : ''}`);
	}
	const { memberId, memberName, ...wg } = access;
	const initialIdentity: SessionMember = { memberId, name: memberName, authUserId: user.id };

	return (
		<WgShell
			code={code}
			wg={wg}
			members={members}
			initialIdentity={initialIdentity}
			initialIsAdmin={initialIsAdmin}
		>
			{children}
		</WgShell>
	);
}

function WgShell({
	code,
	wg,
	members,
	initialIdentity,
	initialIsAdmin,
	children,
}: {
	code: string;
	wg: {
		id: string;
		name: string;
		shareCode: string;
	};
	members: Array<{
		id: string;
		name: string;
		color?: string | null;
		active: boolean;
		isAdmin?: boolean;
		hasAccount?: boolean;
	}>;
	initialIdentity?: SessionMember;
	initialIsAdmin?: boolean;
	children: ReactNode;
}) {
	const t = useTranslations('shell.nav');
	const wgBaseHref = `/wg/${encodeURIComponent(code)}`;

	return (
		<WgContextProvider
			key={wg.id}
			wg={wg}
			members={members}
			initialIdentity={initialIdentity}
			initialIsAdmin={initialIsAdmin}
		>
			<TabWarmup />
			<div
				className="group/wg-shell min-h-svh bg-background"
				style={{
					paddingTop: 'env(safe-area-inset-top, 0px)',
					paddingBottom: 'calc(var(--app-nav-height, 5rem) + 0.5rem)',
				}}
			>
				<OfflineBanner />
				<SessionExpiredBanner />
				<RouteFocusOnNavigate />
				<WgAppHeader />
				{/* WCAG 1.3.1 / 2.4.1 — single <main> landmark.
				    tabIndex={-1} lets the skip-link target receive programmatic focus. */}
				<main id="main" tabIndex={-1} className="focus:outline-none">
					{children}
				</main>
			</div>
			<AppBottomNav label={t('label')}>
				<NavItem
					href={wgBaseHref}
					label={HOME_NAV_LABEL}
					iconKey="home"
					activePrefixes={[`${wgBaseHref}/aktivitaet`]}
				/>
				{WG_SECTIONS.map((section) => (
					<NavItem
						key={section.label}
						href={`${wgBaseHref}/${section.pages[0].slug}`}
						label={section.label}
						iconKey={section.iconKey}
						slugs={section.pages.map((page) => page.slug)}
						activePrefixes={[...section.pages.map((page) => page.slug), ...section.related].map(
							(slug) => `${wgBaseHref}/${slug}`,
						)}
					/>
				))}
			</AppBottomNav>
			{/* Last in the DOM so Tab reaches a toast's dismiss button right after
			    whatever the user just did, instead of jumping back to the page top. */}
			<ToastContainer />
		</WgContextProvider>
	);
}
