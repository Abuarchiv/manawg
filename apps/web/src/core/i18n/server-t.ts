import 'server-only';
import { createTranslator } from 'use-intl/core';
import type { Locale } from '@/shared/i18n/locale';
import { type Message, resolveMessage } from '@/shared/i18n/message';
import messages from '@/shared/i18n/messages';

const TIME_ZONE = 'Europe/Berlin';

/** A translator for server code (push, mail, export, HTML pages) that runs in plain Node. */
export function serverT<N extends keyof (typeof messages)['de']>(locale: Locale, namespace: N) {
	return createTranslator({ locale, messages: messages[locale], namespace, timeZone: TIME_ZONE });
}

export type ServerRootT = ReturnType<typeof serverRootT>;

/** The root translator (keys with the namespace prefix), the argument of `renderMessage`. */
export function serverRootT(locale: Locale) {
	return createTranslator({ locale, messages: messages[locale], timeZone: TIME_ZONE });
}

export function renderMessage(t: ServerRootT, message: Message): string {
	return resolveMessage(t as unknown as Parameters<typeof resolveMessage>[0], message);
}
