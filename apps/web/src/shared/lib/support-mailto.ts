import { isOfficialInstance } from './landing-url';

const SUPPORT_EMAIL =
	process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ||
	(isOfficialInstance(process.env.NEXT_PUBLIC_APP_URL) ? 'info@manawg.com' : '');
// i18n-ignore German support inbox subject
const SUBJECT = 'Fehler%20in%20ManaWG';

/**
 * Pre-filled error report mail used by the error screens and the profile tab; null when the
 * instance has no support address, so the report links are left out. The support inbox is German.
 */
export const SUPPORT_MAILTO = SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}?subject=${SUBJECT}` : null;
