import { SubNav } from '@/components/wg/SubNav';
import type { wgChatMessages } from '@/core/db';
import { loadWgViewer } from '@/core/guards/load-wg-viewer';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
import { CHAT_FRAME_STYLE } from '@/features/chat/chat-frame';
import { ChatView } from '@/features/chat/components/ChatView';
import { loadFixtureWgView } from '@/fixtures/pages';
import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

interface PageProps {
	params: Promise<{ code: string }>;
}

type MessageRow = typeof wgChatMessages.$inferSelect;

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.pages');
	return { title: t('chat'), robots: { index: false, follow: false } };
}

export default async function ChatPage({ params }: PageProps) {
	const { code: rawCode } = await params;
	const code = normalizeShareCode(rawCode);
	if (!isValidShareCode(code)) notFound();

	const fixture = loadFixtureWgView(code);
	if (fixture === 'not_found') notFound();
	if (fixture) return <ChatPageContent wgRow={fixture.wg} messages={fixture.chatMessages()} />;

	// The layout redirects visitors without a session; a WG they do not belong to is a plain 404.
	const viewer = await loadWgViewer(code);
	if (!viewer?.access) notFound();
	const wgRow = viewer.access;

	// No server-side message loading here: ChatView bootstraps its first page through the
	// membership-gated API, which also checks the expected-member header.
	return <ChatPageContent wgRow={wgRow} messages={[]} />;
}

function ChatPageContent({
	wgRow,
	messages,
}: {
	wgRow: { id: string; shareCode: string };
	messages: MessageRow[];
}) {
	const t = useTranslations('chat.page');
	return (
		<div data-chat-frame className="flex min-h-0 flex-col" style={CHAT_FRAME_STYLE}>
			<header className="flex shrink-0 flex-col gap-2 border-b border-border bg-background px-4 pt-3 pb-2">
				<div className="mx-auto flex w-full max-w-4xl items-center gap-2">
					{/* The segment replaces the visible title so the chat does not lose
					    extra height. */}
					<h1 className="sr-only">{t('title')}</h1>
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
					createdAt: m.createdAt.toISOString(),
					editedAt: m.editedAt?.toISOString() ?? null,
					deletedAt: m.deletedAt?.toISOString() ?? null,
				}))}
				initialReactions={[]}
			/>
		</div>
	);
}
