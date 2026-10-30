'use client';

import { MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { segmentCountStatus } from '@/components/wg/segment-count-status';
import { useChatUnreadCount } from '@/components/wg/use-wg-counts';
import {
	LIST_REFRESH_INTERVAL_MS,
	useVisibilityPausedInterval,
} from '@/core/utils/use-visibility-paused-interval';
import { useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';
import { haptic } from '@/shared/lib/haptics';

interface ChatTopBarLinkProps {
	href: string;
	className?: string;
}

const BADGE_MAX = 99;

export function ChatTopBarLink({ href, className }: ChatTopBarLinkProps) {
	const t = useTranslations('shell.chatLink');
	const message = useMessage();
	const pathname = usePathname() ?? '';
	const unread = useChatUnreadCount();
	useVisibilityPausedInterval(() => void unread.refresh(), LIST_REFRESH_INTERVAL_MS);

	const isActive = pathname.endsWith('/chat');
	const count = unread.data?.count;
	// Unread chat messages on the installed app icon (Badging API; Chrome, Edge, Safari 17+ home screen apps)
	useEffect(() => {
		if (count === undefined || !('setAppBadge' in navigator)) return;
		void (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
	}, [count]);
	// The badge is device-global: leaving the WG shell (sign-out, session end, WG list) must not keep this count.
	useEffect(
		() => () => {
			if ('clearAppBadge' in navigator) void navigator.clearAppBadge().catch(() => {});
		},
		[],
	);
	const exactCount = unread.data?.exactCount;
	const accessibleCount = exactCount ?? (unread.data?.overflow ? undefined : count);
	const state =
		count === undefined
			? unread.error
				? 'unavailable'
				: 'loading'
			: unread.error
				? 'stale'
				: 'ready';
	const status = segmentCountStatus({
		count,
		hint: 'unread',
		state,
		overflow: unread.data?.overflow,
		exactCount,
	});
	const statusText = status ? message(status) : '';
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
			aria-label={t('label', { status: statusText })}
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
					? statusText
					: count > 0
						? t('unreadMessages', {
								overflow: accessibleCount === undefined ? 'yes' : 'no',
								count: accessibleCount ?? 0,
							})
						: ''}
			</span>
		</Link>
	);
}
