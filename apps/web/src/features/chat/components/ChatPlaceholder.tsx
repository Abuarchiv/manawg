import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageCircle } from 'lucide-react';

/** Drei Sprechblasen-Platzhalter; bewusst kräftiger als --muted, das im hellen Modus fast weiß ist. */
export function ChatBubbleSkeletons() {
	return (
		<div className="flex flex-col gap-3" aria-hidden>
			<Skeleton className="h-12 w-2/3 rounded-2xl bg-foreground/[0.07]" />
			<Skeleton className="h-9 w-1/2 self-end rounded-2xl bg-foreground/[0.07]" />
			<Skeleton className="h-16 w-3/4 rounded-2xl bg-foreground/[0.07]" />
		</div>
	);
}

export function ChatLoadingPlaceholder() {
	return (
		<output className="block py-2">
			<ChatBubbleSkeletons />
			<span className="sr-only">Nachrichten werden geladen</span>
		</output>
	);
}

export function ChatLoadErrorPlaceholder({ onRetry }: { onRetry: () => void }) {
	return (
		<div className="flex min-h-40 w-full items-center justify-center">
			<Alert variant="destructive" className="max-w-sm text-center">
				<AlertTitle>Chat konnte nicht geladen werden.</AlertTitle>
				<AlertDescription>
					<Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-3">
						Erneut versuchen
					</Button>
				</AlertDescription>
			</Alert>
		</div>
	);
}

export function ChatEmptyPlaceholder() {
	return (
		<div className="py-6">
			<Empty className="border border-dashed">
				<EmptyHeader>
					<EmptyMedia>
						<MessageCircle aria-hidden />
					</EmptyMedia>
					<EmptyTitle>Noch keine Nachrichten</EmptyTitle>
					<EmptyDescription>Schreib die erste.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
}
