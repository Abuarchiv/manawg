import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COPY } from '@/app/global-error-copy';
import de from '@/shared/i18n/messages/de/shell';
import en from '@/shared/i18n/messages/en/shell';

const catalogs = { de, en };

// global-error.tsx has no message provider, so it keeps an inline copy that must match the catalog.
for (const locale of ['de', 'en'] as const) {
	test(`global error copy matches the shell.errorPage catalog (${locale})`, () => {
		const page = catalogs[locale].errorPage;
		assert.equal(COPY[locale].wrong, page.somethingWrong);
		assert.equal(COPY[locale].retry, page.tryAgain);
		assert.equal(COPY[locale].home, page.toHome);
		assert.equal(COPY[locale].report, page.report);
	});
}
