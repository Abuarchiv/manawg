import { type Message, useMessage } from '@/shared/i18n/message';

/** Renders either user content (a plain string) or generated copy (a `Message`). */
export function useText(): (value: string | Message) => string {
	const message = useMessage();
	return (value) => (typeof value === 'string' ? value : message(value));
}
