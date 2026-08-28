import { ToastContainer } from '@/components/ui/Toast';
import { BottomNavMore } from '@/components/wg/BottomNavMore';
import { NavItem } from '@/components/wg/NavItem';
import { OfflineBanner } from '@/components/wg/OfflineBanner';
import { WgContextProvider } from '@/components/wg/WgContextProvider';
import { WgTopBar } from '@/components/wg/WgTopBar';
import { db, wgMembers } from '@/lib/db';
import { getE2EWgFixture, isE2EDbDownMode } from '@/lib/e2e-db-down';
import { isValidShareCode, normalizeShareCode } from '@manawg/shared/lib/share-code';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

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
	if (isE2EDbDownMode()) {
		const fixture = getE2EWgFixture(code);
		return {
			title: fixture ? `${fixture.name} — ManaWG` : 'WG — ManaWG',
			robots: { index: false, follow: false },
		};
	}
	const wg = await db.query.wgs.findFirst({
		where: (w, { eq }) => eq(w.shareCode, code),
		columns: { name: true },
	});
	return {
		title: wg ? `${wg.name} — ManaWG` : 'WG — ManaWG',
		robots: { index: false, follow: false },
	};
}

// craftsman-ignore: TS002 — Next.js App Router requires default export from layout.tsx
export default async function WgLayout({ children, params }: Props) {
	const { code: rawCode } = await params;
	const code = normalizeShareCode(rawCode);
	if (!isValidShareCode(code)) {
		notFound();
	}

	if (isE2EDbDownMode()) {
		const fixture = getE2EWgFixture(code);
		if (!fixture) notFound();
		// Fixture rosters are always fully active.
		const fixtureMembers = fixture.members.map((member) => ({ ...member, active: true }));
		return (
			<WgShell code={code} wg={fixture} members={fixtureMembers}>
				{children}
			</WgShell>
		);
	}

	const wg = await db.query.wgs.findFirst({
		where: (w, { eq }) => eq(w.shareCode, code),
		columns: {
			id: true,
			name: true,
			shareCode: true,
			joiningEnabled: true,
			shareCodeRotatedAt: true,
		},
	});
	if (!wg) {
		notFound();
	}

	// Load the full roster including deactivated members: history and balances
	// need every name. Choice UIs filter on `active` downstream (see
	// WgContextProvider). NULL deactivated_at means active.
	const memberRows = await db
		.select({
			id: wgMembers.id,
			name: wgMembers.name,
			color: wgMembers.color,
			deactivatedAt: wgMembers.deactivatedAt,
		})
		.from(wgMembers)
		.where(eq(wgMembers.wgId, wg.id));
	const members = memberRows.map(({ deactivatedAt, ...member }) => ({
		...member,
		active: deactivatedAt === null,
	}));

	return (
		<WgShell code={code} wg={wg} members={members}>
			{children}
		</WgShell>
	);
}

function WgShell({
	code,
	wg,
	members,
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
	members: Array<{ id: string; name: string; color?: string | null; active: boolean }>;
	children: ReactNode;
}) {
	const wgBaseHref = `/wg/${encodeURIComponent(code)}`;

	return (
		<WgContextProvider wg={wg} members={members}>
			<ToastContainer />
			<div
				className="min-h-svh bg-[var(--bg-base)]"
				style={{
					paddingTop: 'env(safe-area-inset-top, 0px)',
					paddingBottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))',
				}}
			>
				<a
					href="#main"
					className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:inline-flex focus:h-11 focus:items-center focus:rounded-md focus:border focus:border-[var(--accent)] focus:bg-[var(--bg-base)] focus:px-4 focus:text-[13px] focus:font-medium focus:text-[var(--accent)] focus:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2"
				>
					Zum Inhalt springen
				</a>
				<OfflineBanner />
				<WgTopBar code={code} />
				{/* WCAG 1.3.1 / 2.4.1 — single <main> landmark.
				    tabIndex={-1} lets the skip-link target receive programmatic focus. */}
				<main id="main" tabIndex={-1} className="app-page-enter focus:outline-none">
					{children}
				</main>
			</div>
			<nav
				aria-label="WG Hauptnavigation"
				data-app-chrome
				className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--bg-base)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg-base)]/85"
			>
				<ul
					className="mx-auto flex max-w-2xl [&>li]:min-w-0 [&>li]:flex-1"
					style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
				>
					<NavItem href={wgBaseHref} label="Start" iconKey="home" />
					<NavItem href={`${wgBaseHref}/ausgaben`} label="Ausgaben" iconKey="ausgaben" />
					<NavItem href={`${wgBaseHref}/einkauf`} label="Einkauf" iconKey="einkauf" />
					<NavItem href={`${wgBaseHref}/pinnwand`} label="Pinnwand" iconKey="pinnwand" />
					<NavItem href={`${wgBaseHref}/putzen`} label="Putzen" iconKey="putzen" />
					<BottomNavMore
						items={[
							{ href: `${wgBaseHref}/kalender`, label: 'Kalender', iconKey: 'kalender' },
							{ href: `${wgBaseHref}/vorraete`, label: 'Vorräte', iconKey: 'vorraete' },
							{ href: `${wgBaseHref}/abos`, label: 'Abos', iconKey: 'abos' },
							{ href: `${wgBaseHref}/mahnungen`, label: 'Mahnungen', iconKey: 'mahnungen' },
						]}
					/>
				</ul>
			</nav>
		</WgContextProvider>
	);
}
