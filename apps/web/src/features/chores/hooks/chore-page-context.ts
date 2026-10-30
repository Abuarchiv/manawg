import type { useToast } from '@/components/ui/Toast';
import type { Member, WgSummary } from '@/components/wg/WgContextProvider';
import type { SessionMember } from '@/core/auth/local-account';
import type { AbsenceInput } from '@/features/chores/absence';
import type { Chore } from '@/features/chores/components/chore-types';

/** What the cleaning rota hooks share: who acts, where results go, and the loaded plan. */
export interface ChorePageContext {
	wg: Pick<WgSummary, 'id' | 'shareCode'>;
	identity: SessionMember;
	members: Member[];
	activeMembers: Member[];
	encodedShareCode: string;
	toast: ReturnType<typeof useToast>;
	isPending: (id: string) => boolean;
	startPending: (id: string) => void;
	endPending: (id: string) => void;
	setActionError: (message: string | null) => void;
	setActionNotice: (message: string | null) => void;
	items: Chore[];
	absences: AbsenceInput[];
	updateChores: (update: (current: Chore[]) => Chore[]) => void;
	updateAbsences: (update: (current: AbsenceInput[]) => AbsenceInput[]) => void;
	load: (initial: boolean) => Promise<void>;
	refreshCount: () => void;
}
