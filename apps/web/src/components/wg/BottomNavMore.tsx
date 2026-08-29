'use client';

import { haptic } from '@/shared/lib/haptics';
import { MoreHorizontal } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type NavIconKey, NavItem } from './NavItem';

interface OverflowNavItem {
	href: string;
	label: string;
	iconKey: NavIconKey;
}

interface Props {
	items: OverflowNavItem[];
}

export function BottomNavMore({ items }: Props) {
	const pathname = usePathname() ?? '';
	const normalizedPath = pathname.replace(/\/+$/, '');
	const isOverflowActive = items.some((item) => normalizedPath === item.href.replace(/\/+$/, ''));
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false);
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [open]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname change closes overflow menu
	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	const isHighlighted = isOverflowActive || open;

	return (
		<>
			<li>
				<button
					type="button"
					onClick={() => {
						haptic('light');
						setOpen((o) => !o);
					}}
					aria-expanded={open}
					aria-haspopup="menu"
					aria-label={open ? 'Mehr-Menü schließen' : 'Mehr-Menü öffnen'}
					className={`flex w-full min-h-[48px] flex-col items-center justify-center gap-1 rounded-md px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
						isHighlighted
							? 'text-[var(--text-1)]'
							: 'text-[var(--text-2)] hover:text-[var(--text-1)]'
					}`}
				>
					<MoreHorizontal
						className="h-5 w-5"
						strokeWidth={isHighlighted ? 2.25 : 1.75}
						aria-hidden
					/>
					<span className="text-[11px] font-medium leading-none tracking-tight">Mehr</span>
				</button>
			</li>
			{open && (
				<>
					<button
						type="button"
						aria-label="Mehr-Menü schließen"
						className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
						onClick={() => setOpen(false)}
					/>
					<div
						role="menu"
						aria-label="Weitere WG-Navigation"
						className="fixed inset-x-0 z-40 mx-auto max-w-2xl rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg-base)] p-3 shadow-2xl"
						style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }}
					>
						<span className="sheet-handle" aria-hidden />
						<ul className="grid grid-cols-4 gap-1">
							{items.map((item) => (
								<NavItem
									key={item.href}
									href={item.href}
									label={item.label}
									iconKey={item.iconKey}
								/>
							))}
						</ul>
					</div>
				</>
			)}
		</>
	);
}
