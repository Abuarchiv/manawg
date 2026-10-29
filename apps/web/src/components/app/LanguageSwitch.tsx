'use client';

import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useOnlineStatus } from '@/core/hooks/use-online-status';
import {
	clearLocaleCookie,
	deviceLocale,
	isLocale,
	LOCALE_COOKIE,
	type Locale,
	localeCookie,
} from '@/shared/i18n/locale';
import { cn } from '@/shared/lib/cn';
import { saveAccountLocale, syncAccountLocale } from './account-locale';

// Endonyms are never translated.
const OPTIONS: ReadonlyArray<{ value: Locale; label: string }> = [
	{ value: 'de', label: 'Deutsch' },
	{ value: 'en', label: 'English' },
];
type Choice = Locale | 'system';

/** No cookie means the device language decides, like the theme's `system`. */
function readChoice(): Choice {
	const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`));
	return isLocale(match?.[1]) ? match[1] : 'system';
}
const choiceListeners = new Set<() => void>();
function subscribeChoice(listener: () => void) {
	choiceListeners.add(listener);
	return () => {
		choiceListeners.delete(listener);
	};
}

/**
 * Stores the choice in the cookie (rendering) and on the account. A reload renders every screen,
 * title and chunk in the new language; it is skipped when the language stays the same.
 */
async function applyChoice(next: Choice, current: string): Promise<void> {
	const locale = next === 'system' ? deviceLocale() : next;
	// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing in Firefox; the helpers build the fixed value.
	document.cookie = next === 'system' ? clearLocaleCookie() : localeCookie(next);
	for (const listener of choiceListeners) listener();
	await saveAccountLocale(locale);
	if (locale === current) return;
	if ('serviceWorker' in navigator)
		navigator.serviceWorker.controller?.postMessage('refresh-shell');
	window.location.reload();
}

/**
 * Keeps the account language (push and mail) in step with the language shown, e.g. for accounts
 * from before English existed, after switching devices, or after a choice made signed out. The
 * path dependency retries after a sign-in that did not reload the page.
 */
export function DeviceLocaleSync() {
	const current = useLocale();
	const pathname = usePathname();
	// biome-ignore lint/correctness/useExhaustiveDependencies: the path only re-triggers the sync.
	useEffect(() => {
		if (isLocale(current)) void syncAccountLocale(current);
	}, [current, pathname]);
	return null;
}

/** `segmented` fills a settings row and offers `System`; `links` is the quiet entry footer. */
export function LanguageSwitch({ variant }: { variant: 'segmented' | 'links' }) {
	const t = useTranslations('settings.profile');
	const current = useLocale();
	// The server cannot see the choice here; the first client render fills it in.
	const choice = useSyncExternalStore(subscribeChoice, readChoice, () => null);
	const online = useOnlineStatus();
	const [pending, setPending] = useState(false);
	const disabled = !online || pending;

	const choose = (next: string | undefined) => {
		if (disabled || (next !== 'system' && !isLocale(next)) || next === choice) return;
		if (variant === 'links' && next === current) return;
		setPending(true);
		void applyChoice(next, current).finally(() => setPending(false));
	};

	if (variant === 'segmented') {
		return (
			<ToggleGroup
				variant="segmented"
				className="w-full"
				value={choice ? [choice] : []}
				aria-label={t('language')}
				disabled={disabled}
				onValueChange={(values) => choose(values[0])}
			>
				{OPTIONS.map(({ value, label }) => (
					<ToggleGroupItem key={value} value={value} lang={value} className="min-w-max px-1.5">
						{label}
					</ToggleGroupItem>
				))}
				<ToggleGroupItem value="system" className="min-w-max px-1.5">
					{t('languageSystem')}
				</ToggleGroupItem>
			</ToggleGroup>
		);
	}
	return (
		<fieldset aria-label={t('language')} className="flex min-w-0 flex-wrap justify-center">
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
