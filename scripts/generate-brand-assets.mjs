import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const appRequire = createRequire(resolve(root, 'apps/web/package.json'));
const nextRequire = createRequire(appRequire.resolve('next/package.json'));
const sharp = nextRequire('sharp');
const brandMarkPath = resolve(root, 'apps/web/src/shared/lib/brand-mark.json');
let g;
try {
	g = JSON.parse(await readFile(brandMarkPath, 'utf8'));
} catch (error) {
	const reason = error instanceof Error ? error.message : String(error);
	console.error(`[brand-assets] cannot load ${brandMarkPath}: ${reason}`);
	console.error('[brand-assets] restore the brand mark source before regenerating the icons.');
	process.exit(1);
}
const publicDir = resolve(root, 'apps/web/public');

function mark(hole = 22) {
	return `<defs><filter id="goo" x="-12%" y="-12%" width="124%" height="124%"><feGaussianBlur stdDeviation="${g.blur}"/><feColorMatrix type="matrix" values="${g.matrix}"/></filter><mask id="hole" maskUnits="userSpaceOnUse" x="0" y="0" width="416" height="346"><g filter="url(#goo)" fill="white">${g.bodies.map((b) => `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r}"/>`).join('')}</g><circle cx="207" cy="175" r="${hole}" fill="black"/></mask></defs><rect width="416" height="346" fill="white" mask="url(#hole)"/>`;
}
function tile(hole = 22, fraction = 0.62) {
	const scale = (512 * fraction) / g.width;
	const x = (512 - g.width * scale) / 2;
	const y = (512 - g.height * scale) / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0a0a0a"/><g transform="translate(${x} ${y}) scale(${scale})">${mark(hole)}</g></svg>`;
}
// Android masks a notification badge by its alpha channel, so it is the bare white mark on transparency.
function badge(size = 96, fraction = 0.8) {
	const scale = (size * fraction) / g.width;
	const x = (size - g.width * scale) / 2;
	const y = (size - g.height * scale) / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="translate(${x} ${y}) scale(${scale})">${mark()}</g></svg>`;
}
await writeFile(resolve(publicDir, 'icon.svg'), tile());
await writeFile(resolve(publicDir, 'favicon.svg'), tile(26));
for (const [name, size, hole, fraction] of [
	['icon-192.png', 192, 22, 0.62],
	['icon-512.png', 512, 22, 0.62],
	['icon-512-maskable.png', 512, 22, 0.62],
	['apple-touch-icon.png', 180, 22, 0.58],
	['favicon-32.png', 32, 26, 0.78],
	['favicon-16.png', 16, 34, 0.78],
]) {
	const destination = resolve(publicDir, name);
	await sharp(Buffer.from(tile(hole, fraction)), { density: 288 })
		.resize(size, size)
		.flatten({ background: '#0a0a0a' })
		.png()
		.toFile(destination);
	const metadata = await sharp(destination).metadata();
	if (metadata.width !== size || metadata.height !== size || metadata.hasAlpha)
		throw new Error(`Invalid brand asset: ${name}`);
}
const badgePath = resolve(publicDir, 'badge-96.png');
await sharp(Buffer.from(badge()), { density: 288 }).resize(96, 96).png().toFile(badgePath);
const badgeStats = await sharp(badgePath).stats();
if (!(await sharp(badgePath).metadata()).hasAlpha || badgeStats.channels[3].min !== 0)
	throw new Error('Invalid brand asset: badge-96.png');
process.stdout.write(
	'Generated SVG, six opaque PNG brand assets and a transparent notification badge from the brand mark geometry.\n',
);
