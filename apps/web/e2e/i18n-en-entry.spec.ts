// English entry and auth: landing, discovery pages, sign-in, registration, invitation and password reset.
// Why: These screens are the first contact for an English-speaking flatmate; German chrome here loses them.

import { expect, type Page, test } from '@playwright/test';
import {
	FIXTURE_WG,
	mockNoWgs,
	seedLocalAccount,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoGermanChrome, expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

const TOKEN = 'aB3_-xYz09aB3_-xYz09kQ';
const SCHEMES = ['light', 'dark'] as const;
const WIDTHS = [320, 390] as const;

// Slug, English title and description of the ten public discovery pages.
const DISCOVERY_PAGES = [
	['expenses', 'Expenses', 'Shared costs at a glance.'],
	['shopping', 'Shopping', 'What needs to be bought.'],
	['pinboard', 'Noticeboard', 'Information for everyone.'],
	['chores', 'Cleaning rota', 'Tasks shared fairly.'],
	['recurring', 'Fixed costs', 'Recurring costs.'],
	['reminders', 'Reminders', 'Amounts still open.'],
	['supplies', 'Supplies', 'What is still in stock.'],
	['calendar', 'Calendar', 'Shared events.'],
	['activity', 'Activity', 'What happened recently.'],
	['chat', 'Chat', 'For a quick word.'],
] as const;
const DISCOVER_SUFFIX = 'The flat app for expenses, cleaning rota, shopping and noticeboard.';

const TWO_FLATS = [
	{ id: FIXTURE_WG.id, code: FIXTURE_WG.shareCode, name: 'Altbau', memberId: FIXTURE_WG.memberId },
	{ id: 'second-flat', code: 'SMKETEST', name: 'Dachgeschoss', memberId: 'second-member' },
];

// German entry vocabulary the shared list lacks; a word only matches when no letter touches it.
const GERMAN_ENTRY_WORDS = [
	'Anmeldung',
	'Beispiel',
	'Datenschutzerklärung',
	'Konto',
	'Registrierung',
	'Rechtliches',
	'Weiter',
];
const GERMAN_ENTRY_PATTERN = new RegExp(
	GERMAN_ENTRY_WORDS.map((word) => `(?<![\\p{L}])${word}(?![\\p{L}])`).join('|'),
	'u',
);

/** Checks the page language, the shared German chrome list and the entry vocabulary above. */
async function expectEnglishPage(page: Page, width: number): Promise<void> {
	await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
	const text = await page.locator('body').innerText();
	expect(GERMAN_ENTRY_PATTERN.exec(text)?.[0], 'German entry word in English text').toBe(undefined);
	await expectNoGermanChrome(page);
	if (width === 320) await expectNoHorizontalOverflow(page);
}

async function guestSession(page: Page): Promise<void> {
	await setupMember(page);
	await page.route('**/api/wg/mine', (route) =>
		route.fulfill({ status: 401, json: { error: 'auth_required', code: 'auth_required' } }),
	);
	await page.route(`**/api/wg/invites/${TOKEN}`, (route) =>
		route.fulfill({ status: 401, json: { error: 'auth_required', code: 'auth_required' } }),
	);
}

test.describe('entry and auth in English', () => {
	skipUnlessFixtures();

	for (const colorScheme of SCHEMES) {
		for (const width of WIDTHS) {
			test(`signed-out pages render English at ${width}px (${colorScheme})`, async ({
				context,
				page,
				baseURL,
			}) => {
				test.setTimeout(180_000);
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
				await page.setViewportSize({ width, height: 780 });
				await guestSession(page);

				await page.goto('/');
				await expect(
					page.getByText('Example: what everyday life in your flat could look like'),
				).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByRole('link', { name: 'Create account' })).toBeVisible();
				// The fixture server is not the official instance, so only the project link shows.
				await expect(page.getByRole('link', { name: 'About ManaWG' })).toBeVisible();
				await expect(page.getByRole('link', { name: 'Legal notice (German)' })).toBeVisible();
				await expectEnglishPage(page, width);

				await page.goto('/discover/expenses');
				await expect(page.getByRole('heading', { name: 'Expenses', level: 1 })).toBeAttached({
					timeout: 60_000,
				});
				await expect(page.getByText('Example', { exact: true })).toBeVisible();
				await expect(page.getByRole('navigation', { name: 'Discover Money' })).toBeVisible();
				await expectEnglishPage(page, width);

				await page.goto('/login');
				await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByRole('tab', { name: 'Code by email' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
				await expect(
					page.getByText(
						'By signing in, you accept our terms (German) and the privacy policy (German).',
					),
				).toBeVisible();
				await page.getByRole('tab', { name: 'Password' }).click();
				await expect(page.getByRole('button', { name: 'Forgot your password?' })).toBeVisible();
				await expectEnglishPage(page, width);

				await page.goto('/signup');
				await expect(page.getByRole('heading', { name: 'Create account', level: 1 })).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByRole('button', { name: 'Register with Google' })).toBeVisible();
				await expect(
					page.getByText(
						'By registering, you accept our terms (German) and the privacy policy (German).',
					),
				).toBeVisible();
				await expect(page.getByText('Already have an account?')).toBeVisible();
				await expectEnglishPage(page, width);

				await page.goto(`/invite/${TOKEN}`);
				await expect(
					page.getByRole('heading', { name: 'Accept invitation', level: 1 }),
				).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByText('Sign in to join the flat.')).toBeVisible();
				await expectEnglishPage(page, width);

				await page.goto('/auth/reset');
				await expect(page.getByRole('heading', { name: 'Reset password', level: 1 })).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByText('Request a new link below.')).toBeVisible();
				await expectEnglishPage(page, width);
			});

			test(`signed-in pages without a flat render English at ${width}px (${colorScheme})`, async ({
				context,
				page,
				baseURL,
			}) => {
				test.setTimeout(180_000);
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
				await page.setViewportSize({ width, height: 780 });
				await setupMember(page);
				await mockNoWgs(page);
				await page.route(`**/api/wg/invites/${TOKEN}`, (route) =>
					route.fulfill({
						status: 200,
						json: {
							wg: { name: 'Altbau', shareCode: FIXTURE_WG.shareCode },
							unclaimed: [{ id: FIXTURE_WG.memberId, name: 'Anna' }],
						},
					}),
				);

				await page.goto('/');
				await expect(
					page.getByRole('button', { name: 'Sign in with a different account' }),
				).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByRole('link', { name: 'Create flat' }).first()).toBeVisible();
				await expectEnglishPage(page, width);

				await page.goto('/login');
				await expect(page.getByRole('heading', { name: 'Your flat', level: 1 })).toBeVisible({
					timeout: 60_000,
				});
				await expect(
					page.getByText(
						'You do not have a flat yet. Create a new one or join with an invitation.',
					),
				).toBeVisible();
				await expectEnglishPage(page, width);
				await page.getByRole('button', { name: 'Join with an invitation' }).click();
				await expect(page.getByLabel('Invite link')).toBeVisible();
				await expect(page.getByRole('button', { name: 'Open invitation' })).toBeVisible();
				await expectEnglishPage(page, width);

				await page.goto('/login?action=create');
				await expect(
					page.getByRole('heading', { name: 'Create a new flat', level: 1 }),
				).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByLabel('Flat name')).toBeVisible();
				await expect(page.getByLabel('Your display name')).toBeVisible();
				await page.getByRole('button', { name: 'Create flat', exact: true }).click();
				await expect(page.getByText('The flat name is missing.')).toBeVisible();
				await expectEnglishPage(page, width);

				await page.goto(`/invite/${TOKEN}`);
				await expect(
					page.getByRole('heading', { name: 'Join the flat “Altbau”', level: 1 }),
				).toBeVisible({ timeout: 60_000 });
				await expect(page.getByRole('heading', { name: 'Already a member?' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'I am Anna' })).toBeVisible();
				await expectEnglishPage(page, width);

				await page.goto('/invite/not-a-valid-token');
				await expect(
					page.getByRole('heading', { name: 'Invitation not valid', level: 1 }),
				).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByRole('link', { name: 'Go to your flats' })).toBeVisible();
				await expectEnglishPage(page, width);
			});

			test(`signed-out states and errors render English at ${width}px (${colorScheme})`, async ({
				context,
				page,
				baseURL,
			}) => {
				test.setTimeout(240_000);
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
				await page.setViewportSize({ width, height: 780 });
				await guestSession(page);

				for (const [slug, title, description] of DISCOVERY_PAGES) {
					await page.goto(`/discover/${slug}`);
					await expect(page.getByRole('heading', { name: title, level: 1 })).toBeAttached({
						timeout: 60_000,
					});
					await expect(page).toHaveTitle(new RegExp(`^${title}`));
					await expect(page.locator('meta[name="description"]')).toHaveAttribute(
						'content',
						`${description} ${DISCOVER_SUFFIX}`,
					);
					await expectEnglishPage(page, width);
				}

				// Failed callback and malformed invitation notices on the sign-in page.
				await page.goto('/login?error=auth_callback&invite=bad');
				await expect(page.getByText(/^The link could not be used\. It has expired/)).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByText(/^This invite link is incomplete or not valid/)).toBeVisible();
				await expectEnglishPage(page, width);
				await page.goto('/?invite=bad');
				await expect(page.getByText(/^This invite link is incomplete or not valid/)).toBeVisible({
					timeout: 60_000,
				});
				await expectEnglishPage(page, width);

				// Email sign-up: local validation, a throttled server answer, then the inbox state.
				let signUpCalls = 0;
				await page.route('**/api/auth/sign-up', (route) => {
					signUpCalls += 1;
					return signUpCalls === 1
						? route.fulfill({ status: 429, json: { error: 'rate_limited', code: 'rate_limited' } })
						: route.fulfill({ status: 200, json: { sessionEstablished: false } });
				});
				await page.goto('/signup');
				await page.getByLabel('Your name').fill('Mina');
				await page.getByLabel('Email address').fill('mina@example.invalid');
				await page.getByLabel('Password', { exact: true }).fill('short');
				await page.getByLabel('Confirm password').fill('short');
				await expect(page.getByText('At least 8 characters.')).toBeVisible();
				const submitSignUp = page.getByRole('button', { name: 'Create account', exact: true });
				await submitSignUp.click();
				await expect(page.getByText('Your password needs at least 8 characters.')).toBeVisible();
				await expectEnglishPage(page, width);
				await page.getByLabel('Password', { exact: true }).fill('long-enough-pass');
				await page.getByLabel('Confirm password').fill('different-pass');
				await submitSignUp.click();
				await expect(page.getByText('The passwords do not match.')).toBeVisible();
				await page.getByLabel('Confirm password').fill('long-enough-pass');
				await submitSignUp.click();
				await expect(
					page.getByText('Too many attempts. Wait a few minutes and try again.'),
				).toBeVisible();
				await expectEnglishPage(page, width);
				await submitSignUp.click();
				await expect(page.getByText('Check your inbox')).toBeVisible();
				await expect(
					page.getByText(
						/^If no account exists for mina@example\.invalid yet, we have sent a confirmation link/,
					),
				).toBeVisible();
				await expect(page.getByRole('button', { name: /^Resend in \d+ s$/ })).toBeDisabled();
				await expectEnglishPage(page, width);
				await page.getByRole('button', { name: 'Use a different email address' }).click();
				await expect(page.getByLabel('Your name')).toBeVisible();

				// Email code: validation, sent state with the sign-up link, wrong code.
				await page.route('**/api/auth/code-request', (route) =>
					route.fulfill({ status: 200, json: { ok: true } }),
				);
				await page.route('**/api/auth/code-verify', (route) =>
					route.fulfill({ status: 403, json: { error: 'otp_expired', code: 'otp_expired' } }),
				);
				await page.goto('/login');
				await page.getByLabel('Email address').fill('mina@example.invalid');
				await page.getByRole('button', { name: 'Send code by email' }).click();
				const code = page.getByLabel('8-digit code');
				await expect(code).toBeVisible({ timeout: 60_000 });
				await expect(
					page.getByText(
						/^If an account exists for mina@example\.invalid, we have sent a code there/,
					),
				).toBeVisible();
				await expect(page.getByRole('link', { name: 'Create one now.' })).toBeVisible();
				await expect(page.getByText('The code is only valid for a short time.')).toBeVisible();
				await expect(page.getByRole('button', { name: /^Resend code in \d+ s$/ })).toBeDisabled();
				await code.fill('123');
				await page.getByRole('button', { name: 'Sign in', exact: true }).click();
				await expect(page.getByText('Enter the 8-digit code from the email.')).toBeVisible();
				await code.fill('12345678');
				await page.getByRole('button', { name: 'Sign in', exact: true }).click();
				await expect(
					page.getByText('The code is wrong or has expired. Request a new one.'),
				).toBeVisible();
				await expectEnglishPage(page, width);

				// Password sign-in: invalid input, wrong credentials, unconfirmed address, reset mail.
				let signInError = 'invalid_credentials';
				await page.route('**/api/auth/sign-in', (route) =>
					route.fulfill({ status: 400, json: { error: signInError, code: signInError } }),
				);
				await page.route('**/api/auth/resend', (route) =>
					route.fulfill({ status: 200, json: { ok: true } }),
				);
				await page.route('**/api/auth/password-reset', (route) =>
					route.fulfill({ status: 200, json: { ok: true } }),
				);
				await page.goto('/login');
				await page.getByRole('tab', { name: 'Password' }).click();
				const passwordPanel = page.getByRole('tabpanel', { name: 'Password' });
				await passwordPanel.getByRole('button', { name: 'Sign in', exact: true }).click();
				await expect(
					page.getByText('Enter a valid email address and your password.'),
				).toBeVisible();
				await passwordPanel.getByLabel('Email address').fill('mina@example.invalid');
				await passwordPanel.getByLabel('Password', { exact: true }).fill('wrong-password');
				await passwordPanel.getByRole('button', { name: 'Sign in', exact: true }).click();
				await expect(page.getByText(/^The email address or password is incorrect/)).toBeVisible();
				signInError = 'email_not_confirmed';
				await passwordPanel.getByRole('button', { name: 'Sign in', exact: true }).click();
				await expect(page.getByText(/^Your email address is not confirmed yet/)).toBeVisible();
				await page.getByRole('button', { name: 'Resend confirmation email' }).click();
				await expect(
					page.getByText(
						/^If this address is waiting for confirmation, we have sent the email again/,
					),
				).toBeVisible();
				await expectEnglishPage(page, width);
				await page.getByRole('button', { name: 'Forgot your password?' }).click();
				await expect(page.getByText(/^If an account exists for this email address/)).toBeVisible();
				await expectEnglishPage(page, width);

				// Reset page without a recovery session: invalid link notice and the request form.
				await page.goto('/auth/reset');
				await expect(
					page.getByText('This link is not valid or has expired. Request a new link.'),
				).toBeVisible({ timeout: 60_000 });
				await page.getByLabel('Email address').fill('mina@example.invalid');
				await page.getByRole('button', { name: 'Send link' }).click();
				await expect(page.getByText(/^If an account exists for this email address/)).toBeVisible();
				await expectEnglishPage(page, width);
			});

			test(`installed iPhone app shows the English sign-in notice at ${width}px (${colorScheme})`, async ({
				context,
				page,
				baseURL,
			}) => {
				test.setTimeout(180_000);
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
				await page.setViewportSize({ width, height: 780 });
				await page.addInitScript(() => {
					Object.defineProperty(navigator, 'standalone', { value: true });
					Object.defineProperty(navigator, 'userAgent', {
						get: () =>
							'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
					});
				});
				await guestSession(page);
				await page.goto('/login');
				await expect(
					page.getByText(/^On iPhone, the installed app is separate from Safari/),
				).toBeVisible({ timeout: 60_000 });
				await expectEnglishPage(page, width);
			});

			test(`signed-in membership, notices and dialogs render English at ${width}px (${colorScheme})`, async ({
				context,
				page,
				baseURL,
			}) => {
				test.setTimeout(180_000);
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
				await page.setViewportSize({ width, height: 780 });
				await setupMember(page);
				await seedLocalAccount(page);
				await page.addInitScript(
					(action) => localStorage.setItem('manawg:offline-actions', JSON.stringify([action])),
					{
						id: `shopping:${FIXTURE_WG.shareCode}:unsent`,
						idempotencyKey: '11111111-1111-4111-8111-111111111111',
						type: 'shopping.create',
						wgId: FIXTURE_WG.id,
						shareCode: FIXTURE_WG.shareCode,
						memberId: FIXTURE_WG.memberId,
						createdAt: new Date().toISOString(),
						payload: { name: 'Oat milk', quantity: '1' },
					},
				);
				await mockNoWgs(page);
				// Syncing the unsent action fails, so signing out has to ask before discarding it.
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/**`, (route) => route.abort());
				await page.route('**/api/wg/mine', (route) =>
					route.fulfill({ status: 200, json: { wgs: TWO_FLATS } }),
				);

				await page.goto('/?left=1&deleted=1&accountDeletion=pending');
				await expect(page.getByRole('heading', { name: 'Your flats' })).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByText('Where would you like to continue?')).toBeVisible();
				await expect(page.getByRole('link', { name: /Altbau/ })).toBeVisible();
				await expect(page.getByText('Account is being deleted')).toBeVisible();
				await expect(page.getByText(/^ManaWG has removed your access to all flats/)).toBeVisible();
				await expect(page.getByText('Flat deleted')).toBeVisible();
				await expect(page.getByText('You have left the flat')).toBeVisible();
				await expectEnglishPage(page, width);

				await page.goto('/login?reason=moved_out&next=/wg/ABCD2345');
				await expect(
					page.getByText(
						'You are marked as moved out of flat ABCD2345. An admin can reactivate you.',
					),
				).toBeVisible({ timeout: 60_000 });
				await expect(
					page.getByText('Open one of your flats, create a new one or join with an invitation.'),
				).toBeVisible();
				await expectEnglishPage(page, width);
				await page.goto('/login?next=/wg/ABCD2345');
				await expect(page.getByText(/^The link to flat ABCD2345 is out of date/)).toBeVisible({
					timeout: 60_000,
				});
				await expectEnglishPage(page, width);

				await page.getByRole('button', { name: 'Sign in with a different account' }).click();
				const dialog = page.getByRole('dialog');
				await expect(dialog.getByText('Unsent actions')).toBeVisible({ timeout: 60_000 });
				await expect(
					dialog.getByText('1 unsent action will be lost when you sign out.'),
				).toBeVisible();
				await expect(dialog.getByRole('button', { name: 'Sign out anyway' })).toBeVisible();
				await expectEnglishPage(page, width);
			});

			test(`created flat shows the English invitation step at ${width}px (${colorScheme})`, async ({
				context,
				page,
				baseURL,
			}) => {
				test.setTimeout(180_000);
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
				await page.setViewportSize({ width, height: 780 });
				await setupMember(page);
				await mockNoWgs(page);
				await page.route('**/api/wg', (route) =>
					route.request().method() === 'POST'
						? route.fulfill({
								status: 201,
								json: {
									wg: { shareCode: FIXTURE_WG.shareCode, name: 'Altbau' },
									creator: { id: FIXTURE_WG.memberId },
								},
							})
						: route.fallback(),
				);
				let inviteCalls = 0;
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/invites`, (route) => {
					inviteCalls += 1;
					return inviteCalls === 1
						? route.fulfill({ status: 500, json: { error: 'server_error' } })
						: route.fulfill({
								status: 201,
								json: {
									id: 'invite-1',
									url: `https://app.manawg.com/invite/${TOKEN}`,
									expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
								},
							});
				});

				await page.goto('/login?action=create');
				await page.getByLabel('Flat name').fill('Altbau');
				await page.getByLabel('Your display name').fill('Mina');
				await page.getByRole('button', { name: 'Create flat', exact: true }).click();
				await expect(page.getByRole('heading', { name: 'Flat created', level: 1 })).toBeVisible({
					timeout: 60_000,
				});
				await expect(
					page.getByText('Your flat is created. You can now share the invitation.'),
				).toBeVisible();
				await expect(page.getByText('Your flat “Altbau” is live.')).toBeVisible();
				await expect(
					page.getByText('Send your flatmates the invite link. It is valid for 7 days.'),
				).toBeVisible();
				await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
				await expectEnglishPage(page, width);
				await page.getByRole('button', { name: 'Try again' }).click();
				await expect(page.getByRole('button', { name: 'Copy invite link' })).toBeEnabled();
				await expect(page.getByText('Send invitation')).toBeVisible();
				await expect(
					page.getByText('Use your phone’s share function or copy the link.'),
				).toBeVisible();
				await expect(page.getByRole('link', { name: 'Share via WhatsApp' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Invite flatmates' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Go to your flat' })).toBeVisible();
				await expectEnglishPage(page, width);
			});
		}
	}
});
