import type { MutableRefObject } from 'react';
import type { PendingOverlay } from '@/core/sync/use-synced-collection';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';

/** What the shopping list's action hooks share: who acts, the synced list and its feedback. */
export interface ShoppingActionContext {
	wg: { id: string; shareCode: string };
	memberId: string;
	encodedShareCode: string;
	commit: (update: (current: ShoppingItem[]) => ShoppingItem[]) => void;
	/** Unconfirmed rows; polls and cache updates keep showing them until the request settles. */
	pending: PendingOverlay<ShoppingItem>;
	load: (silent?: boolean, afterMutation?: boolean) => Promise<void>;
	refreshCount: () => void;
	isPending: (id: string) => boolean;
	/** Items whose bought state is being saved; blocks a second tap and a delete meanwhile. */
	togglingRef: MutableRefObject<Set<string>>;
	setToggleError: (message: string | null) => void;
	setToggleNotice: (message: string | null) => void;
}
