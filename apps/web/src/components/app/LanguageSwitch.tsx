'use client';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { hasSessionCookie } from '@/core/auth/session-hint';
import { useOnlineStatus } from '@/core/hooks/use-online-status';
import { type Locale, localeCookie } from '@/shared/i18n/locale';
import { cn } from '@/shared/lib/cn';
import { useLocale } from 'next-intl';
import { useState } from 'react';

// Endonyms are never translated. The group label names both languages so it reads in either.
const GROUP_LABEL = 'Sprache / Language'; // i18n-ignore bilingual label of the language group
const OPTIONS: ReadonlyArray<{ value: Locale; label: string }> = [
	{ value: 'de', label: 'Deutsch' },
	{ value: 'en', label: 'English' },
];

/**
 * Stores the choice in the cookie (rendering) and, when signed in, on the account (push and mail);
 * the account write is best effort because the cookie alone already switches the language. The
 * reload renders every screen, title and chunk in the new language.
 */
async function applyLocale(next: Locale): Promise<void> {
	document.cookie = localeCookie(next);
	if (hasSessionCookie()) {
		await fetch('/api/account', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ locale: next }),
		}).catch(() => undefined);
	}
	if ('serviceWorker' in navigator)
		navigator.serviceWorker.controller?.postMessage('refresh-shell');
	window.location.reload();
}

/** `segmented` fills a settings row; `links` is the quiet variant for the entry footer. */
export function LanguageSwitch({ variant }: { variant: 'segmented' | 'links' }) {
	const current = useLocale();
	const online = useOnlineStatus();
	const [pending, setPending] = useState(false);
	const disabled = !online || pending;

	const choose = (next: string | undefined) => {
		if (disabled || (next !== 'de' && next !== 'en') || next === current) return;
		setPending(true);
		void applyLocale(next);
	};

	if (variant === 'segmented') {
		return (
			<ToggleGroup
				variant="segmented"
				className="w-full"
				value={[current]}
				aria-label={GROUP_LABEL}
				disabled={disabled}
				onValueChange={(values) => choose(values[0])}
			>
				{OPTIONS.map(({ value, label }) => (
					<ToggleGroupItem key={value} value={value} lang={value} className="min-w-max px-1.5">
						{label}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		);
	}
	return (
		<fieldset aria-label={GROUP_LABEL} className="flex min-w-0 flex-wrap justify-center">
			{OPTIONS.map(({ value, label }) => (
				<button
					key={value}
					type="button"
					lang={value}
					aria-pressed={value === current}
					disabled={disabled}
					onClick={() => choose(value)}
					className={cn(
						'inline-flex min-h-11 items-center px-2 underline-offset-4 hover:underline disabled:opacity-60',
						value === current && 'font-medium text-foreground',
					)}
				>
					{label}
				</button>
			))}
		</fieldset>
	);
}
