import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// text-meta / text-body are font sizes (globals.css @theme), not colors: without this,
// twMerge would drop one of them next to a text-<color> class.
const twMerge = extendTailwindMerge({
	extend: { classGroups: { 'font-size': [{ text: ['meta', 'body'] }] } },
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
