/**
 * Dark mode for every ManaWG mail (Touchpoints design: card #171717 on #0A0A0A, button turns
 * light, mark stays a mark). The inline styles stay the light design, so clients without
 * `prefers-color-scheme` show it unchanged; this block recolours them by attribute selector.
 * `supabase/templates/*.html` carry the same block (checked in templates.test.ts).
 */
export const MAIL_COLOR_SCHEME_META =
	'<meta name="color-scheme" content="light dark">\n<meta name="supported-color-schemes" content="light dark">';

// Owed and settled get lighter hues so they keep 4.5:1 on #171717.
export const MAIL_DARK_STYLE = `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
.m-dark{display:none;}
@media (prefers-color-scheme: dark){
body,table[style*="background-color:#F5F5F5"]{background-color:#0A0A0A!important;}
table[bgcolor="#FFFFFF"]{background-color:#171717!important;border-color:#2E2E2E!important;}
td[bgcolor="#FAFAFA"]{background-color:#0F0F0F!important;}
td[bgcolor="#171717"]{background-color:#FAFAFA!important;}
div[style*="background-color:#F5F5F5"]{background-color:#262626!important;}
[style*="#E5E5E5"]{border-color:#2E2E2E!important;}
[style*="color:#0A0A0A"]{color:#FAFAFA!important;}
[style*="color:#404040"]{color:#D4D4D4!important;}
[style*="color:#737373"]{color:#A3A3A3!important;}
a[style*="color:#FAFAFA"]{color:#0A0A0A!important;}
[style*="color:#E7000B"]{color:#FF6467!important;}
[style*="background-color:#E7000B"]{background-color:#FF6467!important;}
[style*="color:#14874E"]{color:#3FCF8E!important;}
[style*="background-color:#14874E"]{background-color:#3FCF8E!important;}
.m-light{display:none!important;}
.m-dark{display:block!important;}
}
</style>`;

const MARK_URL = 'https://app.manawg.com/email/manawg-mark-96.png';
const MARK_STYLE = 'width:24px;height:20px;border:0;';

/** The mark in both colours; the light one is hidden in dark mode, the dark one only shown there. */
export function markImages(): string {
	return `<img class="m-light" src="${MARK_URL}" width="24" height="20" alt="" style="display:block;${MARK_STYLE}"><img class="m-dark" src="${MARK_URL.replace('-96.png', '-96-light.png')}" width="24" height="20" alt="" style="display:none;${MARK_STYLE}mso-hide:all;">`;
}
