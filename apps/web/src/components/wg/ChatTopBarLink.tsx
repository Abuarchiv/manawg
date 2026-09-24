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
	const countLabel =
		count === undefined
			? unread.error
				? 'Zähler nicht verfügbar'
				: 'Zähler wird geladen'
			: unread.data?.overflow
				? 'mehr als 99 ungelesen'
				: `${count} ungelesen`;
	const freshness = count !== undefined && unread.error ? ', Stand möglicherweise veraltet' : '';
	const badge =
		count === undefined
			? '!'
			: `${unread.error ? '~' : ''}${
					unread.data?.overflow || count > BADGE_MAX ? `${BADGE_MAX}+` : count
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
					className="absolute -right-1 -top-1 h-4 min-w-4 px-0.5 text-xs leading-none"
				>
					{badge}
				</Badge>
			)}
			<span className="sr-only" aria-live="polite" aria-atomic="true">
				{count === undefined
					? countLabel
					: count > 0
						? unread.data?.overflow
							? 'Mehr als 99 ungelesene Nachrichten'
							: `${count} ungelesene Nachricht${count === 1 ? '' : 'en'}`
						: ''}
			</span>
		</Link>
	);
}
