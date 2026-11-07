import type { Locale } from '@/shared/i18n/locale';

// This boundary sits above the root layout, so it has no message provider: small inline copies.
export const COPY: Record<
	Locale,
	Record<'wrong' | 'reload' | 'retry' | 'home' | 'report', string>
> = {
	de: {
		// i18n-ignore German copy of the provider-less boundary
		wrong: 'Etwas ist schiefgelaufen',
		// i18n-ignore German copy of the provider-less boundary
		reload: 'Bitte lade die Seite neu.',
		// i18n-ignore German copy of the provider-less boundary
		retry: 'Erneut versuchen',
		// i18n-ignore German copy of the provider-less boundary
		home: 'Zur Startseite',
		// i18n-ignore German copy of the provider-less boundary
		report: 'Fehler per E-Mail melden',
	},
	en: {
		wrong: 'Something went wrong',
		reload: 'Please reload the page.',
		retry: 'Try again',
		home: 'Go to home page',
		report: 'Report a problem by email',
	},
	es: {
		wrong: 'Algo ha salido mal',
		reload: 'Vuelve a cargar la página.',
		retry: 'Intentar de nuevo',
		home: 'Ir a la página de inicio',
		report: 'Informar de un problema por correo',
	},
};
