import { richArgument } from '@/components/entry/rich-argument';

/** Monospace tabular amount as a `t.rich` argument. */
export function monoAmount(text: string): string {
	return richArgument(<span className="font-mono tabular-nums">{text}</span>);
}
