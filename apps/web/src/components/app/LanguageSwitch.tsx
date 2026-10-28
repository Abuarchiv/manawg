'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { hasSessionCookie } from '@/core/auth/session-hint';
import { useOnlineStatus } from '@/core/hooks/use-online-status';
import { safeLocalStorage } from '@/core/utils/browser';
import {
	clearLocaleCookie,
	deviceLocale,
	isLocale,
	LOCALE_COOKIE,
	type Locale,
	localeCookie,
} from '@/shared/i18n/locale';
import { cn } from '@/shared/lib/cn';

// Endonyms are never translated. The group label names both languages so it reads in either.
const GROUP_LABEL = 'Sprache / Language'; // i18n-ignore bilingual label of the language group
const OPTIONS: ReadonlyArray<{ value: Locale; label: string }> = [
	{ value: 'de', label: 'Deutsch' },
	{ value: 'en', label: 'English' },
];
/** The locale last stored on the account from this device, so the sync runs once per change. */
const SYNCED_KEY = 'manawg:locale-synced';

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
 * Stores the language on the account (push and mail), best effort because rendering only needs
 * the cookie.
 */
async function saveAccountLocale(locale: Locale): Promise<void> {
	if (!hasSessionCookie()) return;
	const res = await fetch('/api/account', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ locale }),
	}).catch(() => null);
	// An unread body keeps the request open in Chromium, so the page never settles.
	await res?.text().catch(() => undefined);
	if (res?.ok) safeLocalStorage()?.setItem(SYNCED_KEY, locale);
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
 * While the device language decides, keeps the account language (push and mail) in step with it,
 * e.g. for accounts from before English existed or after switching devices.
 */
export function DeviceLocaleSync() {
	const current = useLocale();
	useEffect(() => {
		if (!isLocale(current) || readChoice() !== 'system') return;
		if (safeLocalStorage()?.getItem(SYNCED_KEY) === current) return;
		void saveAccountLocale(current);
	}, [current]);
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
				aria-label={GROUP_LABEL}
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
