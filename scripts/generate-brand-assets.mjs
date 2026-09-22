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
await writeFile(resolve(publicDir, 'icon.svg'), tile());
await writeFile(resolve(publicDir, 'favicon.svg'), tile(26));
await writeFile(
	resolve(publicDir, 'manawg-mark.svg'),
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 416 346">${mark().replace('fill="white" mask=', 'fill="#0a0a0a" mask=')}</svg>`,
);
for (const [name, size, hole, fraction] of [
	['icon-192.png', 192, 22, 0.62],
	['icon-512.png', 512, 22, 0.62],
	['icon-512-maskable.png', 512, 22, 0.62],
	['apple-touch-icon.png', 180, 22, 0.58],
	['manawg-icon-1024.png', 1024, 22, 0.62],
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
process.stdout.write(
	'Generated SVG and seven opaque PNG brand assets from the supplied geometry.\n',
);
