import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publicDir = new URL('../public/', import.meta.url);

test('the push notification badge is a PNG with an alpha channel', () => {
	const worker = readFileSync(new URL('sw.js', publicDir), 'utf8');
	const badge = /badge: '\/([^']+\.png)'/.exec(worker)?.[1];
	assert.ok(badge, 'sw.js sets a PNG badge');
	// Android masks the badge by alpha only; an opaque PNG shows as a solid white square.
	const colorType = readFileSync(new URL(badge, publicDir)).readUInt8(25);
	assert.ok(colorType === 4 || colorType === 6, `${badge} has colour type ${colorType}`);
});
