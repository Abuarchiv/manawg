import { expect, test } from '@playwright/test';
import { OFFLINE_REPLAY_MAX_AGE_MS } from '../src/core/offline/replay-retention';
import { chatDraftKey } from '../src/features/chat/chat-draft';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('chat send after an unknown result', () => {
	skipUnlessFixtures();

	test('retries a send the server accepted after a reload with the same idempotency key', async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const messages: Array<Record<string, unknown>> = [];
		const acceptedByKey = new Map<string, Record<string, unknown>>();
		const idempotencyKeys: string[] = [];
		const body = 'Der Send wurde angenommen';
		const draftKey = chatDraftKey(FIXTURE_WG.shareCode, FIXTURE_WG.memberId);

		await page.setViewportSize({ width: 390, height: 844 });
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}`, (route) =>
			route.fulfill({
				json: {
					currentMember: { memberId: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName },
				},
			}),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, (route) =>
			route.fulfill({
				json: { members: [{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName }] },
			}),
		);
		await mockUnreadCount(page, `/api/wg/${FIXTURE_WG.shareCode}`);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chat/read`, (route) =>
			route.fulfill({ json: { ok: true, applied: true } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chat/messages*`, async (route) => {
			if (route.request().method() !== 'POST') {
				return route.fulfill({ json: { messages, reactions: [], reads: [], readMarker: null } });
			}
			const key = route.request().headers()['idempotency-key'] ?? '';
			idempotencyKeys.push(key);
			let message = acceptedByKey.get(key);
			if (!message) {
				const payload = route.request().postDataJSON() as { body: string };
				message = {
					id: `sent-${messages.length + 1}`,
					wgId: FIXTURE_WG.id,
					senderMemberId: FIXTURE_WG.memberId,
					kind: 'user',
					body: payload.body,
					imageUrl: null,
					replyToMessageId: null,
					systemKind: null,
					systemPayload: null,
					createdAt: new Date().toISOString(),
					editedAt: null,
					deletedAt: null,
				};
				acceptedByKey.set(key, message);
				messages.push(message);
			}
			if (idempotencyKeys.length === 1) return route.abort('failed');
			return route.fulfill({ json: { message, warning: null } });
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/chat`);
		await dismissOnboarding(page);
		const composer = page.getByRole('textbox', { name: 'Chat-Nachricht' });
		const send = page.getByRole('button', { name: 'Nachricht senden' });
		const pendingDraftKey = () =>
			page.evaluate(
				(key) => JSON.parse(localStorage.getItem(key) ?? '{}').pendingSend?.key,
				draftKey,
			);
		await expect(composer).toBeVisible();
		await composer.fill(body);
		await expect
			.poll(() =>
				page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').body, draftKey),
			)
			.toBe(body);
		await send.click();
		await expect.poll(() => idempotencyKeys.length).toBe(1);
		await expect(composer).toHaveValue(body);
		await expect(send).toBeEnabled();
		await expect.poll(pendingDraftKey).toBe(idempotencyKeys[0]);

		await page.reload({ waitUntil: 'domcontentloaded' });
		await dismissOnboarding(page);
		const restoredComposer = page.getByRole('textbox', { name: 'Chat-Nachricht' });
		await expect(restoredComposer).toHaveValue(body);
		await expect.poll(pendingDraftKey).toBe(idempotencyKeys[0]);
		await page.getByRole('button', { name: 'Nachricht senden' }).click();
		await expect.poll(() => idempotencyKeys.length).toBe(2);

		expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
		expect(messages).toHaveLength(1);
	});

	test('blocks the same send after the replay window and shows the history hint', async ({
		page,
	}) => {
		const body = 'Nur einmal sicher senden';
		const draftKey = chatDraftKey(FIXTURE_WG.shareCode, FIXTURE_WG.memberId);
		let postRequests = 0;
		await setupMember(page);
		await page.addInitScript(
			({ key, messageBody, createdAtMs }) => {
				localStorage.setItem(
					key,
					JSON.stringify({
						body: messageBody,
						replyToMessageId: null,
						pendingSend: {
							fingerprint: JSON.stringify({
								body: messageBody,
								mentionMemberIds: [],
								replyToMessageId: null,
							}),
							key: '22222222-2222-4222-8222-222222222222',
							createdAtMs,
						},
					}),
				);
			},
			{ key: draftKey, messageBody: body, createdAtMs: Date.now() - OFFLINE_REPLAY_MAX_AGE_MS - 1 },
		);

		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}`, (route) =>
			route.fulfill({
				json: {
					currentMember: { memberId: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName },
				},
			}),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, (route) =>
			route.fulfill({
				json: { members: [{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName }] },
			}),
		);
		await mockUnreadCount(page, `/api/wg/${FIXTURE_WG.shareCode}`);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chat/read`, (route) =>
			route.fulfill({ json: { ok: true, applied: true } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chat/messages*`, async (route) => {
			if (route.request().method() === 'POST') postRequests += 1;
			return route.fulfill({ json: { messages: [], reactions: [], reads: [], readMarker: null } });
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/chat`);
		await dismissOnboarding(page);
		const composer = page.getByRole('textbox', { name: 'Chat-Nachricht' });
		await expect(composer).toHaveValue(body);
		await page.getByRole('button', { name: 'Nachricht senden' }).click();
		await expect(
			page.getByText(
				'Der sichere Wiederholzeitraum ist abgelaufen oder unklar. Prüfe den Chatverlauf, bevor du diese Nachricht erneut sendest.',
			),
		).toBeVisible();
		await expect(composer).toHaveValue(body);
		expect(postRequests).toBe(0);
	});
});
