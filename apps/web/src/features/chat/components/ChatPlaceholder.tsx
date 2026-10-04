import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { MessageScrollerItem } from '@/components/ui/message-scroller';
import { Spinner } from '@/components/ui/spinner';
import { MessageCircle } from 'lucide-react';

export function ChatLoadingPlaceholder() {
	return (
		<MessageScrollerItem>
			<output className="flex min-h-40 items-center justify-center">
				<Spinner className="size-5" aria-hidden />
				<span className="sr-only">Nachrichten werden geladen</span>
			</output>
		</MessageScrollerItem>
	);
}

export function ChatLoadErrorPlaceholder({ onRetry }: { onRetry: () => void }) {
	return (
		<MessageScrollerItem className="flex min-h-40 w-full items-center justify-center">
			<Alert variant="destructive" className="max-w-sm text-center">
				<AlertTitle>Chat konnte nicht geladen werden.</AlertTitle>
				<AlertDescription>
					<Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-3">
						Erneut laden
					</Button>
				</AlertDescription>
			</Alert>
		</MessageScrollerItem>
	);
}

export function ChatEmptyPlaceholder() {
	return (
		<MessageScrollerItem className="py-6">
			<Empty className="border border-dashed">
				<EmptyHeader>
					<EmptyMedia>
						<MessageCircle aria-hidden />
					</EmptyMedia>
					<EmptyTitle>Noch keine Nachrichten</EmptyTitle>
					<EmptyDescription>Schreib die erste.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</MessageScrollerItem>
	);
}
