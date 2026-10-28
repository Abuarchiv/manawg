// Points the official origins in the mail templates at another instance: `appUrl` for the app,
// `legalUrl` for the imprint and privacy policy (scripts/supabase-auth-templates.mjs, Docker setup).
export function renderTemplate(html, appUrl, legalUrl) {
	return html
		.replaceAll('>app.manawg.com<', `>${new URL(appUrl).host}<`)
		.replaceAll('https://app.manawg.com', appUrl)
		.replaceAll('https://manawg.com', legalUrl);
}
