import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember } from './_helpers';

test.setTimeout(300_000);

test('search field hides the native cancel icon so only the custom clear button shows', async ({
	page,
}) => {
	await setupMember(page);
	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/suche`);

	const input = page.locator('#wg-search');
	// The custom "Suche leeren" button is the only clear affordance; the
	// browser's own ::-webkit-search-cancel-button must stay suppressed or it
	// renders a second, overlapping "x" on top of the input text.
	await expect(input).toHaveClass(/\[&::-webkit-search-cancel-button\]:hidden/);

	await input.fill('Miete');
	await page.selectOption('#search-quick-filter', 'open');
	await page.getByRole('button', { name: 'Suche leeren' }).click();

	await expect(input).toHaveValue('');
	await expect(page.locator('#search-quick-filter')).toHaveValue('all');
});
