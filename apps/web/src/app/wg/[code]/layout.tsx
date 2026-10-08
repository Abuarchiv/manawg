import { AppBottomNav } from '@/components/app/AppBottomNav';
import { RouteFocusOnNavigate } from '@/components/app/RouteFocusOnNavigate';
import { WgAppHeader } from '@/components/app/WgAppHeader';
import { WG_SECTIONS } from '@/components/app/navigation';
import { ToastContainer } from '@/components/ui/Toast';
import { NavItem } from '@/components/wg/NavItem';
import { OfflineBanner } from '@/components/wg/OfflineBanner';
import { WgContextProvider } from '@/components/wg/WgContextProvider';
import type { StoredIdentity } from '@/core/auth/identity';
import { getAuthenticatedUserFromCookies } from '@/core/auth/server';
import { db, wgMembers, wgs } from '@/core/db';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
import { loadFixtureWgView } from '@/fixtures/pages';
import { and, eq, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { type ReactNode, cache } from 'react';
import { TabWarmup } from './_components/TabWarmup';

interface Props {
	children: ReactNode;
	params: Promise<{ code: string }>;
}

export async function generateMetadata({
	params,
}: { params: Promise<{ code: string }> }): Promise<Metadata> {
	const { code: rawCode } = await params;
	const code = normalizeShareCode(rawCode);
	if (!isValidShareCode(code)) {
		return { robots: { index: false, follow: false } };
	}
	const fixture = loadFixtureWgView(code);
	if (fixture) {
		return {
			title: fixture === 'not_found' ? 'WG — ManaWG' : `${fixture.wg.name} — ManaWG`,
			robots: { index: false, follow: false },
		};
	}
	const viewer = await getWgViewer(code);
	return {
		title: viewer?.access ? `${viewer.access.name} — ManaWG` : 'WG — ManaWG',
		robots: { index: false, follow: false },
	};
}

/**
 * Session and membership once per request: generateMetadata and the layout both
 * need them, and getUser() is a network call to Supabase Auth.
 */
const getWgViewer = cache(async (code: string) => {
	const user = await getAuthenticatedUserFromCookies();
	if (!user) return null;
	const [access] = await db
		.select({
			id: wgs.id,
			name: wgs.name,
			shareCode: wgs.shareCode,
			joiningEnabled: wgs.joiningEnabled,
			shareCodeRotatedAt: wgs.shareCodeRotatedAt,
			memberId: wgMembers.id,
			memberName: wgMembers.name,
		})
		.from(wgMembers)
		.innerJoin(wgs, eq(wgMembers.wgId, wgs.id))
		.where(
			and(
				eq(wgs.shareCode, code),
				eq(wgMembers.authUserId, user.id),
				isNull(wgMembers.deactivatedAt),
			),
		)
		.limit(1);
	return { user, access };
});

export default async function WgLayout({ children, params }: Props) {
	const { code: rawCode } = await params;
	const code = normalizeShareCode(rawCode);
	if (!isValidShareCode(code)) {
		notFound();
	}

	const fixture = loadFixtureWgView(code);
	if (fixture === 'not_found') notFound();
	if (fixture) {
		return (
			<WgShell code={code} wg={fixture.wg} members={fixture.members} sessionless>
				{children}
			</WgShell>
		);
	}

	const viewer = await getWgViewer(code);
	if (!viewer) redirect(`/neu?next=${encodeURIComponent(`/wg/${encodeURIComponent(code)}`)}`);
	const { user, access } = viewer;
	if (!access) {
		redirect(`/neu?next=${encodeURIComponent(`/wg/${encodeURIComponent(code)}`)}`);
	}
	const { memberId, memberName, ...wg } = access;
	const initialIdentity: StoredIdentity = { memberId, name: memberName, authUserId: user.id };

	// Load the full roster including deactivated members: history and balances
	// need every name. Choice UIs filter on `active` downstream (see
	// WgContextProvider). NULL deactivated_at means active.
	const memberRows = await db
		.select({
			id: wgMembers.id,
			name: wgMembers.name,
			color: wgMembers.color,
			role: wgMembers.role,
			paypalMerchantId: wgMembers.paypalMerchantId,
			deactivatedAt: wgMembers.deactivatedAt,
		})
		.from(wgMembers)
		.where(eq(wgMembers.wgId, wg.id));
	// Same rule as isWgAdmin: the first active admin row. Session is server-verified.
	const initialIsAdmin =
		memberRows.find((row) => row.role === 'admin' && row.deactivatedAt === null)?.id === memberId;
	const members = memberRows.map(({ deactivatedAt, role: _role, ...member }) => ({
		...member,
		active: deactivatedAt === null,
	}));

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
	sessionless,
	children,
}: {
	code: string;
	wg: {
		id: string;
		name: string;
		shareCode: string;
		joiningEnabled: boolean;
		shareCodeRotatedAt?: string | Date | null;
	};
	members: Array<{
		id: string;
		name: string;
		color?: string | null;
		paypalMerchantId?: string | null;
		active: boolean;
	}>;
	initialIdentity?: StoredIdentity;
	initialIsAdmin?: boolean;
	sessionless?: boolean;
	children: ReactNode;
}) {
	const wgBaseHref = `/wg/${encodeURIComponent(code)}`;

	return (
		<WgContextProvider
			key={wg.id}
			wg={wg}
			members={members}
			initialIdentity={initialIdentity}
			initialIsAdmin={initialIsAdmin}
			sessionless={sessionless}
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
				<RouteFocusOnNavigate />
				<WgAppHeader />
				{/* WCAG 1.3.1 / 2.4.1 — single <main> landmark.
				    tabIndex={-1} lets the skip-link target receive programmatic focus. */}
				<main id="main" tabIndex={-1} className="focus:outline-none">
					{children}
				</main>
			</div>
			<AppBottomNav label="WG Hauptnavigation">
				<NavItem
					href={wgBaseHref}
					label="Start"
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
				{/* Vier Ziele nach Candidate A: Start, Haushalt (Einkauf/Vorräte/
				    Putzen/Kalender), Finanzen (Ausgaben/Fixkosten/Mahnungen/Import),
				    Austausch (Pinnwand/Chat). Alle bisherigen Deep Links lösen
				    weiter auf; Aktivität/Einstellungen bleiben über
				    Header- und Start-Verlinkungen erreichbar. */}
			</AppBottomNav>
			{/* Last in the DOM so Tab reaches a toast's dismiss button right after
			    whatever the user just did, instead of jumping back to the page top. */}
			<ToastContainer />
		</WgContextProvider>
	);
}
