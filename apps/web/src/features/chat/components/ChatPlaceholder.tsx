import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
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

/** Three speech-bubble placeholders; deliberately stronger than --muted, which is almost white in light mode. */
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
	const t = useTranslations('chat.placeholder');
	return (
		<output className="block py-2">
			<ChatBubbleSkeletons />
			<span className="sr-only">{t('loading')}</span>
		</output>
	);
}

export function ChatLoadErrorPlaceholder({ onRetry }: { onRetry: () => void }) {
	const t = useTranslations('chat.placeholder');
	return (
		<div className="flex min-h-40 w-full items-center justify-center">
			<Alert variant="destructive" className="max-w-sm text-center">
				<AlertTitle>{t('loadFailed')}</AlertTitle>
				<AlertDescription>
					<Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-3">
						{t('retry')}
					</Button>
				</AlertDescription>
			</Alert>
		</div>
	);
}

export function ChatEmptyPlaceholder() {
	const t = useTranslations('chat.placeholder');
	return (
		<div className="py-6">
			<Empty className="border border-dashed">
				<EmptyHeader>
					<EmptyMedia>
						<MessageCircle aria-hidden />
					</EmptyMedia>
					<EmptyTitle>{t('emptyTitle')}</EmptyTitle>
					<EmptyDescription>{t('emptyHint')}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
}
