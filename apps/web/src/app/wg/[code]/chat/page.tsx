import { SubNav } from '@/components/wg/SubNav';
import { db, type wgChatMessages, wgs } from '@/core/db';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
import { ChatView } from '@/features/chat/components/ChatView';
import { loadFixtureWgView } from '@/fixtures/pages';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface PageProps {
	params: Promise<{ code: string }>;
}

type MessageRow = typeof wgChatMessages.$inferSelect;
type ReactionRow = { messageId: string; memberId: string; emoji: string };

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: 'Chat — ManaWG',
	robots: { index: false, follow: false },
};

export default async function ChatPage({ params }: PageProps) {
	const { code: rawCode } = await params;
	const code = normalizeShareCode(rawCode);
	if (!isValidShareCode(code)) notFound();

	const fixture = loadFixtureWgView(code);
	if (fixture === 'not_found') notFound();
	if (fixture) return <ChatPageContent wgRow={fixture.wg} messages={fixture.chatMessages()} />;

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

function ChatPageContent({
	wgRow,
	messages,
	reactions = [],
}: {
	wgRow: { id: string; name: string; shareCode: string };
	messages: MessageRow[];
	reactions?: ReactionRow[];
}) {
	return (
		<div
			data-chat-frame
			className="flex min-h-0 flex-col"
			style={{
				height:
					'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - var(--offline-banner-height, 0px) - var(--app-header-height, 0px))',
				// ChatView already ends the frame above the nav; cancel the shell's nav padding.
				marginBottom: 'calc(-1 * (var(--app-nav-height, 5rem) + 0.5rem))',
			}}
		>
			<header className="flex shrink-0 flex-col gap-2 border-b border-border bg-background px-4 pt-3 pb-2">
				<div className="mx-auto flex w-full max-w-4xl items-center gap-2">
					{/* Das Segment ersetzt den sichtbaren Titel, damit der Chat keine
					    zusätzliche Höhe verliert. */}
					<h1 className="sr-only">Chat</h1>
					<SubNav className="flex-1" />
				</div>
			</header>
			<ChatView
				key={wgRow.id}
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
			/>
		</div>
	);
}
