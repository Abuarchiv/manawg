import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('anonymous WG requests return auth_required before WG lookup', async ({ request }) => {
	const response = await request.get('/api/wg/MTE8PZAT/chat/messages');

	expect(response.status()).toBe(401);
	expect(await response.json()).toEqual({
		error: 'auth_required',
		code: 'auth_required',
	});
});

test('WG root verifies identity before looking up a live share code', () => {
	const source = readFileSync(join(__dirname, '../src/app/api/wg/[code]/route.ts'), 'utf8');
	const getHandler = source
		.split('export async function GET(')[1]
		?.split('export async function PATCH(')[0];
	if (!getHandler) throw new Error('GET handler not found');
	expect(getHandler.indexOf('if (isE2EDbDownMode())')).toBeLessThan(
		getHandler.indexOf('getAuthenticatedUser(req)'),
	);
	expect(getHandler.indexOf('getAuthenticatedUser(req)')).toBeLessThan(
		getHandler.indexOf('db.query.wgs.findFirst('),
	);
	expect(getHandler).toContain('requireMember(req, wg.id, user)');
});
