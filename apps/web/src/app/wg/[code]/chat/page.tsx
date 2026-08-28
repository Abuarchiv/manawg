import { db, type wgChatMessages, wgs } from '@/core/db';
import { getE2EWgFixture, isE2EDbDownMode } from '@/core/infra/e2e-db-down';
import { ChatView } from '@/features/chat/components/ChatView';
import { isValidShareCode, normalizeShareCode } from '@manawg/shared/lib/share-code';
import { eq } from 'drizzle-orm';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface PageProps {
	params: Promise<{ code: string }>;
}

type MessageRow = typeof wgChatMessages.$inferSelect;
type ReactionRow = { messageId: string; memberId: string; emoji: string };
type MentionRow = { messageId: string; mentionedMemberId: string };

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: 'Chat — ManaWG',
	robots: { index: false, follow: false },
};

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default async function ChatPage({ params }: PageProps) {
	const { code: rawCode } = await params;
	const code = normalizeShareCode(rawCode);
	if (!isValidShareCode(code)) notFound();

	if (isE2EDbDownMode()) {
		const fixture = getE2EWgFixture(code);
		if (!fixture) notFound();
		return <ChatPageContent wgRow={fixture} messages={buildE2EChatMessages(fixture.id)} />;
	}

	const wg = await db
		.select({ id: wgs.id, name: wgs.name, shareCode: wgs.shareCode })
		.from(wgs)
		.where(eq(wgs.shareCode, code))
		.limit(1);
	const wgRow = wg[0];
	if (!wgRow) notFound();

	// SECURITY: no server-side message loading here. The RSC has no member
	// identity (headers are only sent by apiFetch), so anything loaded here
	// would leak chat history to anyone holding the share code. ChatView
	// bootstraps its first page through the membership-gated API instead.
	return <ChatPageContent wgRow={wgRow} messages={[]} />;
}

function buildE2EChatMessages(wgId: string): MessageRow[] {
	const now = Date.now();
	return [
		{
			id: '1c2c9254-5945-4774-9f03-d12e772d3a6f',
			wgId,
			senderMemberId: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
			kind: 'user',
			body: 'Das ist eine ziemlich lange Chat-Nachricht mit einem_saehr_langen_ununterbrochenen_Wort_das_trotzdem_nicht_die_mobile_Ansicht_sprengen_darf.',
			imageUrl: null,
			replyToMessageId: null,
			systemKind: null,
			systemPayload: null,
			createdAt: new Date(now - 120_000),
			editedAt: null,
			deletedAt: null,
		},
		{
			id: '8c1bb4a9-4722-42fe-bb86-aebf2e2d5b11',
			wgId,
			senderMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
			kind: 'user',
			body: 'Alles klar, ich bringe Hafermilch mit.',
			imageUrl: null,
			replyToMessageId: '1c2c9254-5945-4774-9f03-d12e772d3a6f',
			systemKind: null,
			systemPayload: null,
			createdAt: new Date(now - 60_000),
			editedAt: null,
			deletedAt: null,
		},
	] as MessageRow[];
}

function ChatPageContent({
	wgRow,
	messages,
	reactions = [],
	mentions = [],
}: {
	wgRow: { id: string; name: string; shareCode: string };
	messages: MessageRow[];
	reactions?: ReactionRow[];
	mentions?: MentionRow[];
}) {
	const wgBaseHref = `/wg/${encodeURIComponent(wgRow.shareCode)}`;

	return (
		<div
			className="flex flex-col"
			style={{
				minHeight:
					'calc(100dvh - 3.5rem - 4.25rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
			}}
		>
			<header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2">
				<Link
					href={wgBaseHref}
					aria-label="Zurück zur WG"
					className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)]"
				>
					<ArrowLeft className="h-4 w-4" aria-hidden />
				</Link>
				<span className="truncate text-[17px] font-semibold text-[var(--text-1)]">
					{wgRow.name}
				</span>
			</header>
			<ChatView
				wgId={wgRow.id}
				shareCode={wgRow.shareCode}
				initialMessages={messages.map((m) => ({
					...m,
					body: m.deletedAt ? null : m.body,
					imageUrl: m.deletedAt ? null : m.imageUrl,
					systemPayload:
						m.systemPayload && typeof m.systemPayload === 'object'
							? (m.systemPayload as Record<string, unknown>)
							: null,
					createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
					editedAt: m.editedAt instanceof Date ? m.editedAt.toISOString() : (m.editedAt ?? null),
					deletedAt:
						m.deletedAt instanceof Date ? m.deletedAt.toISOString() : (m.deletedAt ?? null),
				}))}
				initialReactions={reactions}
				initialMentions={mentions}
			/>
		</div>
	);
}
