import { useTranslations } from 'next-intl';
import type deMessages from './messages/de';

type Paths<T> = {
	[K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type MessageKey = Paths<typeof deMessages>;

/** A translatable message as data: pure modules return it, components render it with `useMessage`. */
export type Message = { key: MessageKey; values?: Record<string, string | number | Message> };

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Renders `message` through a root translator; nested `Message` values are rendered first. */
export function resolveMessage(translate: Translate, message: Message): string {
	const { values } = message;
	if (!values) return translate(message.key);
	const rendered: Record<string, string | number> = {};
	for (const [name, value] of Object.entries(values)) {
		rendered[name] = typeof value === 'object' ? resolveMessage(translate, value) : value;
	}
	return translate(message.key, rendered);
}

export function useMessage(): (message: Message) => string {
	// The typed translator rejects dynamic keys; `Message` is already key-checked.
	const translate = useTranslations() as unknown as Translate;
	return (message) => resolveMessage(translate, message);
}
