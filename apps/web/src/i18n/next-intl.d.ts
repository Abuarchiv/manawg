import type { Locale } from '@/shared/i18n/locale';
import type deMessages from '@/shared/i18n/messages/de';

declare module 'next-intl' {
	interface AppConfig {
		Locale: Locale;
		Messages: typeof deMessages;
	}
}
