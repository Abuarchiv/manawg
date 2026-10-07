'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { StartStep } from './start-flow';

const STEPS: readonly StartStep[] = ['choose', 'create', 'join', 'joinName', 'invite'];
const RANK: Record<StartStep, number> = { choose: 0, create: 1, join: 1, joinName: 2, invite: 3 };

function isStep(value: unknown): value is StartStep {
	return typeof value === 'string' && (STEPS as readonly string[]).includes(value);
}

function entry(step: StartStep, pushed: boolean) {
	return pushed ? { neuStep: step, neuPushed: true } : { neuStep: step };
}

function isPushed(): boolean {
	return Boolean(window.history.state?.neuPushed);
}

/**
 * Mirrors the start-flow steps into browser history so the back gesture goes
 * to the previous step instead of leaving /neu. Entry states carry the step;
 * `neuPushed` marks entries created here (the page's first entry never is).
 */
export function useStepHistory({
	interactive,
	step,
	setStep,
	onPop,
	canEnter,
}: {
	interactive: boolean;
	step: StartStep;
	setStep: (step: StartStep) => void;
	/** Called after the browser moved to `target` (clear errors etc.). */
	onPop: (target: StartStep) => void;
	/** Steps that need data (joinName, invite) fall back to the choose step without it. */
	canEnter: (target: StartStep) => boolean;
}) {
	const stepRef = useRef(step);
	// Step a programmatic history.back() is about to land on; its popstate needs no extra handling.
	const expectedPopRef = useRef<StartStep | null>(null);
	stepRef.current = step;
	const callbacksRef = useRef({ setStep, onPop, canEnter });
	callbacksRef.current = { setStep, onPop, canEnter };

	useEffect(() => {
		if (!interactive) return;
		window.history.replaceState(entry(stepRef.current, false), '');
		const onPopState = (event: PopStateEvent) => {
			const target: unknown = event.state?.neuStep;
			if (!isStep(target)) return;
			if (expectedPopRef.current === target) {
				expectedPopRef.current = null;
				return;
			}
			expectedPopRef.current = null;
			const { setStep, onPop, canEnter } = callbacksRef.current;
			const next = canEnter(target) ? target : target === 'joinName' ? 'join' : 'choose';
			setStep(next);
			onPop(next);
		};
		window.addEventListener('popstate', onPopState);
		return () => window.removeEventListener('popstate', onPopState);
	}, [interactive]);

	/**
	 * Moves to `next`: forward adds a history entry, the invite step replaces
	 * the form's, going back pops our own entry (or rewrites the first one).
	 */
	const goTo = useCallback((next: StartStep): void => {
		const current = stepRef.current;
		if (next === 'invite') {
			window.history.replaceState(entry(next, isPushed()), '');
		} else if (RANK[next] > RANK[current]) {
			window.history.pushState(entry(next, true), '');
		} else if (isPushed()) {
			expectedPopRef.current = next;
			window.history.back();
		} else {
			window.history.replaceState(entry(next, false), '');
		}
		callbacksRef.current.setStep(next);
	}, []);

	/** Back button: reset the step's errors right away, then step back. */
	const goBack = useCallback(
		(target: StartStep): void => {
			callbacksRef.current.onPop(target);
			goTo(target);
		},
		[goTo],
	);

	return { goTo, goBack };
}
