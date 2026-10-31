// Shared WCAG contrast sampler for page.evaluate: runs in the browser against computed colors.

// Regression for WCAG 1.4.11 (Non-text Contrast, 3:1 minimum): the shadcn default
// theme shipped --input: oklch(0.922 0 0) and --ring: oklch(0.708 0 0) in light mode,
// which only reach 1.26:1 and 2.59:1 against a white page/card background. That made
// unfocused text-input borders and the unchecked Switch's track/thumb boundary (which
// is filled with --input, see components/animate-ui/components/base/switch.tsx) and
// the focus-visible ring (--ring) nearly invisible in light mode. Dark mode already
// passed (--input/--ring are darker there) and must stay that way.
//
// This runs the real contrast math against the browser's *computed* colors (Chromium
// serializes them as oklch()/oklab(), not rgb()) rather than re-deriving oklch by hand,
// so it catches any future token change that regresses the ratio, not just this one.
export function sampleBoundaryContrast(args: {
	selector: string;
	pseudo?: string;
	prop: 'backgroundColor' | 'borderTopColor' | 'color';
	/** Compare against this element/pseudo instead of walking up to the nearest opaque ancestor. */
	against?: { selector: string; pseudo?: string };
}) {
	function parseToLinearSrgb(str: string): { r: number; g: number; b: number; a: number } | null {
		const oklchM = str.match(/oklch\(([^)]+)\)/);
		const oklabM = str.match(/oklab\(([^)]+)\)/);
		const rgbM = str.match(/rgba?\(([^)]+)\)/);
		const oklchOrOklabM = oklchM ?? oklabM;
		if (oklchOrOklabM) {
			const raw = oklchOrOklabM[1] ?? '';
			const [main = '', alphaPart] = raw.split('/').map((s) => s.trim());
			const [n0 = Number.NaN, n1 = Number.NaN, n2 = Number.NaN] = main
				.split(/\s+/)
				.map((s) => Number.parseFloat(s));
			const a = alphaPart ? Number.parseFloat(alphaPart) : 1;
			let L: number;
			let A: number;
			let B: number;
			if (oklchM) {
				L = n0;
				A = n1 * Math.cos((n2 * Math.PI) / 180);
				B = n1 * Math.sin((n2 * Math.PI) / 180);
			} else {
				[L, A, B] = [n0, n1, n2];
			}
			const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
			const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
			const s_ = L - 0.0894841775 * A - 1.291485548 * B;
			const l = l_ ** 3;
			const m = m_ ** 3;
			const s = s_ ** 3;
			const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
			const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
			const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
			return { r, g, b, a };
		}
		// The CSS pipeline also emits CIE lab() (D50), which Chromium keeps in computed styles.
		const labM = str.match(/(?<!ok)lab\(([^)]+)\)/);
		if (labM) {
			const [main = '', alphaPart] = (labM[1] ?? '').split('/').map((s) => s.trim());
			const [L = Number.NaN, A = Number.NaN, B = Number.NaN] = main
				.split(/\s+/)
				.map((s) => Number.parseFloat(s));
			const a = alphaPart ? Number.parseFloat(alphaPart) : 1;
			const eps = 216 / 24389;
			const kappa = 24389 / 27;
			const fy = (L + 16) / 116;
			const fx = fy + A / 500;
			const fz = fy - B / 200;
			const x = 0.96422 * (fx ** 3 > eps ? fx ** 3 : (116 * fx - 16) / kappa);
			const y = L > kappa * eps ? fy ** 3 : L / kappa;
			const z = 0.82521 * (fz ** 3 > eps ? fz ** 3 : (116 * fz - 16) / kappa);
			// Bradford D50 -> D65, then XYZ -> linear sRGB (CSS Color 4 matrices).
			const X = 0.9554734215 * x - 0.0230984549 * y + 0.0632592432 * z;
			const Y = -0.0283697093 * x + 1.009995398 * y + 0.0210414412 * z;
			const Z = 0.0123140149 * x - 0.0205076493 * y + 1.3303659262 * z;
			return {
				r: 3.2409699419 * X - 1.5373831776 * Y - 0.4986107603 * Z,
				g: -0.9692436363 * X + 1.8759675015 * Y + 0.0415550574 * Z,
				b: 0.0556300797 * X - 0.2039769589 * Y + 1.0569715142 * Z,
				a,
			};
		}
		if (rgbM) {
			const [red = Number.NaN, green = Number.NaN, blue = Number.NaN, alpha = 1] = (rgbM[1] ?? '')
				.split(',')
				.map((s) => Number.parseFloat(s.trim()));
			const srgbToLinear = (v: number) => {
				const c = v / 255;
				return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
			};
			return {
				r: srgbToLinear(red),
				g: srgbToLinear(green),
				b: srgbToLinear(blue),
				a: alpha,
			};
		}
		return null;
	}
	function luminance(c: { r: number; g: number; b: number }) {
		return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
	}
	function contrast(
		c1: { r: number; g: number; b: number },
		c2: { r: number; g: number; b: number },
	) {
		const L1 = luminance(c1);
		const L2 = luminance(c2);
		const [a, b] = L1 > L2 ? [L1, L2] : [L2, L1];
		return (a + 0.05) / (b + 0.05);
	}
	function composite(
		fg: { r: number; g: number; b: number; a: number },
		bg: { r: number; g: number; b: number },
	) {
		return {
			r: fg.r * fg.a + bg.r * (1 - fg.a),
			g: fg.g * fg.a + bg.g * (1 - fg.a),
			b: fg.b * fg.a + bg.b * (1 - fg.a),
		};
	}
	function nearestOpaqueBg(el: Element): string {
		let node: Element | null = el;
		while (node) {
			const bg = getComputedStyle(node).backgroundColor;
			const parsed = parseToLinearSrgb(bg);
			if (parsed && parsed.a > 0.99) return bg;
			node = node.parentElement;
		}
		return getComputedStyle(document.body).backgroundColor;
	}
	const el = document.querySelector(args.selector);
	if (!el) return { error: `not found: ${args.selector}` };
	const boundaryRaw = args.pseudo
		? getComputedStyle(el, args.pseudo)[args.prop]
		: getComputedStyle(el)[args.prop];
	let pageRaw: string;
	if (args.against) {
		const againstEl = document.querySelector(args.against.selector);
		if (!againstEl) return { error: `not found: ${args.against.selector}` };
		pageRaw = args.against.pseudo
			? getComputedStyle(againstEl, args.against.pseudo).backgroundColor
			: getComputedStyle(againstEl).backgroundColor;
	} else {
		pageRaw = nearestOpaqueBg(el.parentElement ?? el);
	}
	const page = parseToLinearSrgb(pageRaw);
	const boundary = parseToLinearSrgb(boundaryRaw);
	if (!page || !boundary) return { error: 'unparseable color', boundaryRaw, pageRaw };
	// The "adjacent color" surface itself might be semi-transparent (e.g. the dark-mode
	// unchecked track uses an alpha fill); composite it onto an opaque backdrop first.
	const backdrop = args.against ? parseToLinearSrgb(nearestOpaqueBg(el.parentElement ?? el)) : null;
	const opaquePage = backdrop && page.a < 0.99 ? composite(page, backdrop) : page;
	const composited = composite(boundary, opaquePage);
	return {
		boundaryRaw,
		pageRaw,
		ratio: Number(contrast(composited, opaquePage).toFixed(2)),
	};
}
