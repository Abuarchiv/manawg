import type { Message } from '@/shared/i18n/message';
import type { CountHint, SegmentCountState } from './use-wg-counts';

interface SegmentCountStatusInput {
	count: number | undefined;
	hint?: CountHint | undefined;
	state: SegmentCountState | undefined;
	overflow?: boolean | undefined;
	exactCount?: number | undefined;
}

/** Spoken status of a segment count ("3 open", "count loading"); null when there is nothing to say. */
export function segmentCountStatus(input: SegmentCountStatusInput): Message | null {
	const { count, state, overflow, exactCount } = input;
	if (count === undefined && state !== 'loading' && state !== 'unavailable') return null;
	const shown = count === undefined ? state : state === 'stale' ? 'stale' : 'ready';
	return {
		key: 'shell.counter.status',
		values: {
			state: shown ?? 'ready',
			overflow: exactCount === undefined && overflow ? 'yes' : 'no',
			count: exactCount ?? count ?? 0,
			hint: input.hint ?? 'open',
			stale: shown === 'stale' ? 'yes' : 'no',
		},
	};
}
