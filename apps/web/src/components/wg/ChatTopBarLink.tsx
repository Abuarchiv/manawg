'use client';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { useChatUnreadCount } from '@/components/wg/useWgCounts';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { cn } from '@/shared/lib/cn';
import { haptic } from '@/shared/lib/haptics';
import { MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface ChatTopBarLinkProps {
	href: string;
	className?: string;
}

const REFRESH_MS = 30_000;
const BADGE_MAX = 99;

export function ChatTopBarLink({ href, className }: ChatTopBarLinkProps) {
	const pathname = usePathname() ?? '';
	const unread = useChatUnreadCount();
	useVisibilityPausedInterval(() => void unread.refresh(), REFRESH_MS);

	const isActive = pathname.endsWith('/chat');
	const count = unread.data?.count;
	const exactCount = unread.data?.exactCount;
	const accessibleCount = exactCount ?? (unread.data?.overflow ? undefined : count);
	const countLabel =
		count === undefined
			? unread.error
				? 'Zähler nicht verfügbar'
				: 'Zähler wird geladen'
			: accessibleCount === undefined
				? 'mehr als 99 ungelesen'
				: `${accessibleCount} ungelesen`;
	const freshness = count !== undefined && unread.error ? ', Stand möglicherweise veraltet' : '';
	const badge =
		count === undefined
			? '!'
			: `${unread.error ? '~' : ''}${
					unread.data?.overflow || count > BADGE_MAX || (exactCount ?? 0) > BADGE_MAX
						? `${BADGE_MAX}+`
						: count
				}`;
	const showBadge =
		count === undefined ? Boolean(unread.error) : count > 0 || Boolean(unread.error);

	function handleClick(): void {
		if (!isActive) haptic('light');
	}

	return (
		<Link
			href={href}
			aria-label={`Chat öffnen, ${countLabel}${freshness}`}
			aria-current={isActive ? 'page' : undefined}
			onClick={handleClick}
			className={
				className ??
				cn(
					buttonVariants({ variant: 'outline', size: 'icon' }),
					'relative size-9',
					isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
				)
			}
		>
			<MessageCircle className="h-4 w-4" aria-hidden />
			{showBadge && (
				<Badge
					variant="destructive"
					aria-hidden
					className={cn(
						// Centered on the corner and growing with the font size: two to three characters
						// extend to the right instead of past the speech bubble.
						'absolute top-0 right-0 h-auto min-h-4 min-w-4 translate-x-[60%] -translate-y-[40%] px-0.5 py-0.5 text-xs leading-none',
						badge.length > 1 && 'ring-2 ring-background',
					)}
				>
					{badge}
				</Badge>
			)}
			<span className="sr-only" aria-live="polite" aria-atomic="true">
				{count === undefined
					? countLabel
					: count > 0
						? accessibleCount === undefined
							? 'Mehr als 99 ungelesene Nachrichten'
							: `${accessibleCount} ungelesene Nachricht${accessibleCount === 1 ? '' : 'en'}`
						: ''}
			</span>
		</Link>
	);
}
