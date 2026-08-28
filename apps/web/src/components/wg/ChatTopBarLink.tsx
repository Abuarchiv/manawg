'use client';

import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { haptic } from '@manawg/shared/lib/haptics';
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
				[
					'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-base)] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
					isActive
						? 'text-[var(--accent)] hover:text-[var(--accent)]'
						: 'text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]',
				].join(' ')
			}
		>
			<MessageCircle className="h-4 w-4" aria-hidden />
			{count > 0 && (
				<span
					aria-hidden
					className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-0.5 text-[9px] font-semibold leading-none text-white"
				>
					{badge}
				</span>
			)}
			<span className="sr-only" aria-live="polite" aria-atomic="true">
				{count > 0 ? `${count} ungelesene Nachrichten` : ''}
			</span>
		</Link>
	);
}
