'use client';

import { readDraft, removeDraft, writeDraft } from '@/core/offline/drafts';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
	START_DRAFT_KEY,
	type StartDraft,
	type StartStep,
	getNeuIntentFromSearch,
} from './start-flow';

/**
 * Step and form inputs of the start flow, restored once from the saved draft
 * (or the URL intent) on mount. `interactive` turns true after that restore.
 */
export function useStartDraft() {
	const searchParams = useSearchParams();
	const [step, setStep] = useState<StartStep>('choose');
	const [wgName, setWgName] = useState('');
	const [creatorName, setCreatorName] = useState('');
	const [inviteLink, setInviteLink] = useState('');
	const [interactive, setInteractive] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initializer — reads the saved draft and initial URL params once; adding searchParams would re-run on navigation and clobber in-progress step/draft state.
	useEffect(() => {
		const initialSearch =
			typeof window === 'undefined' ? searchParams.toString() : window.location.search;
		const initialParams = new URLSearchParams(initialSearch);
		const intent = getNeuIntentFromSearch(initialSearch);
		const draft = readDraft<StartDraft>(START_DRAFT_KEY);
		if (draft?.wgName) setWgName(draft.wgName);
		if (draft?.creatorName) setCreatorName(draft.creatorName);
		// The create form is not reopened from a draft: the typed values stay, but a bare /neu
		// opens the choose step (the create link carries its own step in the URL).
		if (intent.create || initialParams.get('action') === 'create') setStep('create');
		setInteractive(true);
	}, []);

	function resetDraft(intent: { create: boolean }): void {
		removeDraft(START_DRAFT_KEY);
		setStep(intent.create ? 'create' : 'choose');
		setWgName('');
		setCreatorName('');
		setInviteLink('');
	}

	return {
		step,
		setStep,
		wgName,
		setWgName,
		creatorName,
		setCreatorName,
		inviteLink,
		setInviteLink,
		interactive,
		resetDraft,
	};
}

/**
 * Persists the in-progress inputs under START_DRAFT_KEY and drops the draft
 * once the WG exists. Separate from useStartDraft so it runs after the
 * account-WG effects, in the original effect order.
 */
export function useSaveStartDraft({
	interactive,
	step,
	wgName,
	creatorName,
}: {
	interactive: boolean;
	step: StartStep;
	wgName: string;
	creatorName: string;
}): void {
	useEffect(() => {
		if (!interactive) return;
		if (step === 'invite') {
			removeDraft(START_DRAFT_KEY);
			return;
		}
		const draft: StartDraft = { step, wgName, creatorName };
		const hasDraft = [wgName, creatorName].some((value) => value.trim().length > 0);
		if (hasDraft) writeDraft(START_DRAFT_KEY, draft);
		else removeDraft(START_DRAFT_KEY);
	}, [creatorName, interactive, step, wgName]);
}
