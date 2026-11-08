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

// Resolves the `{{ if eq .Data.locale "en" }}en{{ else if eq .Data.locale "es" }}es{{ else }}de{{ end }}`
// blocks the way Supabase Auth does when it renders a mail, so previews and tests can look at one
// language at a time. The hosted and Docker Auth services evaluate the blocks themselves; the
// pushed templates keep them.
export function selectLocale(text, locale) {
	return text.replace(
		/\{\{\s*if eq \.Data\.locale "en"\s*\}\}([\s\S]*?)\{\{\s*else if eq \.Data\.locale "es"\s*\}\}([\s\S]*?)\{\{\s*else\s*\}\}([\s\S]*?)\{\{\s*end\s*\}\}/g,
		(_, en, es, de) => (locale === 'en' ? en : locale === 'es' ? es : de),
	);
}

// Resolves the `{{ if eq .Data.registration "code" }}a{{ else }}b{{ end }}` blocks, which may
// contain locale blocks of their own: a mail for an account created by the sign-up code (`code`)
// shows the code and no link, any other account gets the link. Supabase Auth evaluates these
// itself; previews and tests pick one side.
export function selectRegistration(text, registration) {
	const open = /\{\{\s*if eq \.Data\.registration "code"\s*\}\}/;
	const token = /\{\{\s*(if|else if|else|end)\b[^}]*\}\}/g;
	let out = '';
	let rest = text;
	for (let match = open.exec(rest); match; match = open.exec(rest)) {
		const bodyStart = match.index + match[0].length;
		token.lastIndex = bodyStart;
		let depth = 0;
		let elseStart = -1;
		let elseEnd = -1;
		let done = false;
		for (let t = token.exec(rest); t && !done; t = token.exec(rest)) {
			if (t[1] === 'if') depth++;
			else if (t[1] === 'else' && depth === 0) {
				elseStart = t.index;
				elseEnd = t.index + t[0].length;
			} else if (t[1] === 'end') {
				if (depth > 0) depth--;
				else {
					const code = rest.slice(bodyStart, elseStart < 0 ? t.index : elseStart);
					const other = elseStart < 0 ? '' : rest.slice(elseEnd, t.index);
					out += rest.slice(0, match.index) + (registration === 'code' ? code : other);
					rest = rest.slice(t.index + t[0].length);
					done = true;
				}
			}
		}
		if (!done) throw new Error('unterminated registration block');
	}
	return out + rest;
}
