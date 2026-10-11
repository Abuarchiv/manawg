'use client';

import { readDraft, removeDraft, writeDraft } from '@/core/offline/drafts';
import { normalizeShareCode } from '@/core/utils/share-code';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
	type JoinWg,
	START_DRAFT_KEY,
	type StartDraft,
	type StartStep,
	getNeuIntentFromSearch,
	isJoinWg,
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
	const [joinCode, setJoinCode] = useState('');
	const [joinName, setJoinName] = useState('');
	const [joinWg, setJoinWg] = useState<JoinWg | null>(null);
	const [interactive, setInteractive] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initializer — reads the saved draft and initial URL params once; adding searchParams would re-run on navigation and clobber in-progress step/draft state.
	useEffect(() => {
		const initialSearch =
			typeof window === 'undefined' ? searchParams.toString() : window.location.search;
		const initialParams = new URLSearchParams(initialSearch);
		const intent = getNeuIntentFromSearch(initialSearch);
		const code = intent.joinCode;
		const draft = readDraft<StartDraft>(START_DRAFT_KEY);
		if (draft?.wgName) setWgName(draft.wgName);
		if (draft?.creatorName) setCreatorName(draft.creatorName);
		if (draft?.joinName) setJoinName(draft.joinName);
		if (code) {
			setJoinCode(code);
			setStep('join');
		} else if (intent.create || initialParams.get('action') === 'create') {
			setStep('create');
		} else {
			if (draft?.joinCode) setJoinCode(draft.joinCode);
			if (draft?.step === 'joinName' && isJoinWg(draft.joinWg)) {
				const restoredCode = normalizeShareCode(draft.joinWg.code);
				setJoinWg({ code: restoredCode, name: `WG ${restoredCode}` });
				setStep('joinName');
			}
			// Create/join forms are not reopened from a draft: the typed values stay, but a bare /neu
			// opens the choose step (create and invite links carry their own step in the URL).
		}
		setInteractive(true);
	}, []);

	function resetDraft(intent: { joinCode: string; create: boolean }): void {
		removeDraft(START_DRAFT_KEY);
		setStep(intent.joinCode ? 'join' : intent.create ? 'create' : 'choose');
		setWgName('');
		setCreatorName('');
		setJoinCode(intent.joinCode);
		setJoinName('');
		setJoinWg(null);
	}

	return {
		step,
		setStep,
		wgName,
		setWgName,
		creatorName,
		setCreatorName,
		joinCode,
		setJoinCode,
		joinName,
		setJoinName,
		joinWg,
		setJoinWg,
		interactive,
		resetDraft,
	};
}

/**
 * Fills empty name fields with the account's name once the visitor is signed in
 * (Google profile or the sign-up form); typed or restored names are never overwritten.
 */
export function useAccountNamePrefill(
	authenticated: boolean,
	setCreatorName: (update: (current: string) => string) => void,
	setJoinName: (update: (current: string) => string) => void,
): void {
	useEffect(() => {
		if (!authenticated) return;
		let active = true;
		import('@/core/auth/client')
			.then(({ getAccountName }) => getAccountName())
			.then((name) => {
				if (!active || !name) return;
				setCreatorName((current) => current || name);
				setJoinName((current) => current || name);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [authenticated, setCreatorName, setJoinName]);
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
	joinCode,
	joinName,
	joinWg,
}: {
	interactive: boolean;
	step: StartStep;
	wgName: string;
	creatorName: string;
	joinCode: string;
	joinName: string;
	joinWg: JoinWg | null;
}): void {
	useEffect(() => {
		if (!interactive) return;
		if (step === 'invite') {
			removeDraft(START_DRAFT_KEY);
			return;
		}
		const draft: StartDraft = {
			step,
			wgName,
			creatorName,
			joinCode,
			joinName,
			...(joinWg ? { joinWg } : {}),
		};
		const hasDraft = [wgName, creatorName, joinCode, joinName].some(
			(value) => value.trim().length > 0,
		);
		if (hasDraft) writeDraft(START_DRAFT_KEY, draft);
		else removeDraft(START_DRAFT_KEY);
	}, [creatorName, interactive, joinCode, joinName, joinWg, step, wgName]);
}
