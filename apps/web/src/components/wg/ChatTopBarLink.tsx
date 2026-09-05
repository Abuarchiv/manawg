'use client';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { cn } from '@/shared/lib/cn';
import { haptic } from '@/shared/lib/haptics';
import { MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

interface ChatTopBarLinkProps {
	href: string;
	className?: string;
}

const REFRESH_MS = 30_000;
const BADGE_MAX = 99;

export function ChatTopBarLink({ href, className }: ChatTopBarLinkProps) {
	const { wg, identity } = useWg();
	const pathname = usePathname() ?? '';
	const [count, setCount] = useState(0);
	const encodedShareCode = encodeURIComponent(wg.shareCode);

	const refresh = useCallback(async () => {
		if (!identity.memberId) return;
		const res = await apiFetch<{ count: number }>(`/api/wg/${encodedShareCode}/chat/unread-count`, {
			memberId: identity.memberId,
		});
		if (res.ok) setCount(res.data.count);
	}, [encodedShareCode, identity.memberId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (pathname.endsWith('/chat')) setCount(0);
	}, [pathname]);

	useVisibilityPausedInterval(() => void refresh(), REFRESH_MS);

	const isActive = pathname.endsWith('/chat');
	const badge = count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);

	function handleClick() {
		if (!isActive) haptic('light');
	}

	return (
		<Link
			href={href}
			aria-label={count > 0 ? `Chat öffnen, ${count} ungelesen` : 'Chat öffnen'}
			aria-current={isActive ? 'page' : undefined}
			onClick={handleClick}
			className={
				className ??
				cn(
					buttonVariants({ variant: 'outline', size: 'icon' }),
					'relative size-11',
					isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
				)
			}
		>
			<MessageCircle className="h-4 w-4" aria-hidden />
			{count > 0 && (
				<Badge
					variant="destructive"
					aria-hidden
					className="absolute -right-1 -top-1 h-4 min-w-4 px-0.5 text-[9px] leading-none"
				>
					{badge}
				</Badge>
			)}
			<span className="sr-only" aria-live="polite" aria-atomic="true">
				{count > 0 ? `${count} ungelesene Nachrichten` : ''}
			</span>
		</Link>
	);
}
