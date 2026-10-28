import type { Message, MessageKey } from '@/shared/i18n/message';

const NAV_KEY = /shell\.nav\.[A-Za-z]+/g;

/** Replaces the `shell.nav.*` catalog keys inside a navigation label with their text. */
export function navText(label: string, message: (value: Message) => string): string {
	return label.replace(NAV_KEY, (key) => message({ key: key as MessageKey }));
}
