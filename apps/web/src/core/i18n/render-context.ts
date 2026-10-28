import type { RenderContext } from '@/core/audit-messages';
import { renderMessage, serverRootT } from '@/core/i18n/server-t';
import type { Locale } from '@/shared/i18n/locale';

/** Renders messages in plain Node for the feeds, in the reader's locale. */
export function serverRenderContext(locale: Locale): RenderContext {
	const t = serverRootT(locale);
	return { locale, render: (message) => renderMessage(t, message) };
}
