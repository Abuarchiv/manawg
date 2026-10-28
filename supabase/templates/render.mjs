const LEGAL_LINK =
	/ &middot; <a href="https:\/\/manawg\.com\/(?:impressum|datenschutz)"[^>]*>[\s\S]*?<\/a>/g;

// Points the official origins in the mail templates at another instance: `appUrl` for the app,
// `legalUrl` for the imprint and privacy policy (scripts/supabase-auth-templates.mjs, Docker setup).
// Without a `legalUrl` the footer links to the imprint and privacy policy are left out.
export function renderTemplate(html, appUrl, legalUrl) {
	const withLegal = legalUrl
		? html.replaceAll('https://manawg.com', legalUrl)
		: html.replace(LEGAL_LINK, '');
	return withLegal
		.replaceAll('>app.manawg.com<', `>${new URL(appUrl).host}<`)
		.replaceAll('https://app.manawg.com', appUrl);
}

// Resolves the `{{ if eq .Data.locale "en" }}en{{ else }}de{{ end }}` blocks the way Supabase Auth
// does when it renders a mail, so previews and tests can look at one language at a time. The
// hosted and Docker Auth services evaluate the blocks themselves; the pushed templates keep them.
export function selectLocale(text, locale) {
	return text.replace(
		/\{\{\s*if eq \.Data\.locale "en"\s*\}\}([\s\S]*?)\{\{\s*else\s*\}\}([\s\S]*?)\{\{\s*end\s*\}\}/g,
		(_, en, de) => (locale === 'en' ? en : de),
	);
}
