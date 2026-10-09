import { Skeleton } from '@/components/ui/skeleton';
import { ChatBubbleSkeletons } from '@/features/chat/components/ChatPlaceholder';

// Mirrors page.tsx (frame, tab bar, history, composer) so nothing shifts while loading.
export default function ChatLoading() {
	return (
		<output
			data-chat-frame
			className="flex min-h-0 flex-col"
			aria-label="Chat wird geladen"
			aria-busy="true"
			style={{
				height:
					'calc(100dvh - env(safe-area-inset-top, 0px) - var(--safe-area-bottom, 0px) - var(--banner-stack-height, 0px) - var(--app-header-height, 0px))',
				marginBottom: 'calc(-1 * (var(--app-nav-height, 5rem) + 0.5rem))',
			}}
		>
			<div className="flex shrink-0 flex-col gap-2 border-b border-border bg-background px-4 pt-3 pb-2">
				<Skeleton className="mx-auto h-8 w-full max-w-4xl bg-foreground/[0.07]" />
			</div>
			<div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col justify-end overflow-hidden px-4 py-2">
				<ChatBubbleSkeletons />
			</div>
			<div className="shrink-0 border-t border-border bg-background">
				<div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-2">
					<Skeleton className="h-11 flex-1 rounded-3xl bg-foreground/[0.07]" />
				</div>
			</div>
		</output>
	);
}
