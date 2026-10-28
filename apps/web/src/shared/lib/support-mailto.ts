/** Pre-filled error report mail used by the error screens and the profile tab. The support inbox is German. */
// i18n-ignore German support inbox subject
export const SUPPORT_MAILTO = `mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || 'info@manawg.com'}?subject=Fehler%20in%20ManaWG`;
