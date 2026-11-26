import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import type { ShareOutcome } from '@/components/wg/invite-share';

// InviteStep rendered without a DOM: a small hook store stands in for React, JSX becomes plain
// `{ type, props }` objects, and every control is found by its props and tapped via its handler.

type Props = { [name: string]: unknown; children?: unknown };
type Captured = { event: string; properties?: Record<string, unknown> };

const captured: Captured[] = [];
const reply: { created: boolean; share: ShareOutcome; copied: boolean } = {
	created: true,
	share: 'shared',
	copied: true,
};
let slots: unknown[] = [];
let cursor = 0;
let effects: Array<() => unknown> = [];
let skips = 0;

mock.module('react', {
	namedExports: {
		useState(initial: unknown) {
			const slot = cursor++;
			if (!(slot in slots)) slots[slot] = initial;
			const set = (next: unknown) => {
				slots[slot] = typeof next === 'function' ? next(slots[slot]) : next;
			};
			return [slots[slot], set];
		},
		useRef(current: unknown) {
			const slot = cursor++;
			if (!(slot in slots)) slots[slot] = { current };
			return slots[slot];
		},
		useEffect(effect: () => unknown, deps: readonly unknown[]) {
			const slot = cursor++;
			const last = slots[slot] as readonly unknown[] | undefined;
			if (last?.every((dep, i) => Object.is(dep, deps[i]))) return;
			slots[slot] = deps;
			effects.push(effect);
		},
	},
});
const element = (type: unknown, props: Props) => ({ type, props });
mock.module('react/jsx-runtime', {
	namedExports: { jsx: element, jsxs: element, Fragment: 'Fragment' },
});
mock.module('next-intl', { namedExports: { useTranslations: () => (key: string) => key } });
mock.module('@/shared/i18n/message', {
	namedExports: { useMessage: () => (message: { key: string }) => message.key },
});
mock.module('@/shared/lib/analytics', {
	defaultExport: {
		capture: (event: string, properties?: Record<string, unknown>) =>
			captured.push(properties ? { event, properties } : { event }),
	},
});
mock.module('@/components/wg/invite-share', {
	namedExports: {
		createInvite: async () =>
			reply.created
				? {
						ok: true,
						invite: {
							id: 'invite-1',
							url: 'https://app.example/invite/secret-token',
							expiresAt: '2026-12-10T00:00:00.000Z',
						},
					}
				: { ok: false, message: { key: 'shell.inviteShare.createFailed' } },
		inviteShareMessage: () => ({ key: 'shell.inviteShare.text' }),
		shareInvite: async () => reply.share,
	},
});
mock.module('@/core/utils/clipboard', { namedExports: { copyText: async () => reply.copied } });
mock.module('@/components/ui/button', {
	namedExports: { Button: 'Button', buttonVariants: () => '' },
});
// Presentational pieces stay element types: the harness never renders below InviteStep.
for (const [specifier, names] of [
	['@/components/app/ErrorBox', ['ErrorBox']],
	['@/components/ui/badge', ['Badge']],
	['@/components/ui/card', ['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle']],
	['@/components/ui/spinner', ['Spinner']],
	['lucide-react', ['AlertTriangle', 'ArrowRight', 'Check', 'Copy', 'MessageCircle', 'Share2']],
] as const) {
	mock.module(specifier, { namedExports: Object.fromEntries(names.map((name) => [name, name])) });
}
// The share notice resets on a timer that no assertion waits for.
Object.assign(globalThis, { window: { setTimeout: () => 0, clearTimeout: () => {} } });

const { InviteStep } = await import('./InviteStep');

const settle = () => new Promise(setImmediate);

/** One render as React runs it: pending work settles, the step renders, changed effects run. */
async function render(): Promise<unknown> {
	await settle();
	cursor = 0;
	const tree: unknown = InviteStep({
		code: 'ABCD2345',
		wgName: 'Flat 3B',
		memberId: 'member-1',
		onSkip: () => {
			skips++;
		},
	});
	for (const effect of effects.splice(0)) effect();
	return tree;
}

/** The first render starts the link request, the second shows the link. */
async function ready(): Promise<unknown> {
	await render();
	return render();
}

function elements(node: unknown): Props[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== 'object' || !('props' in node)) return [];
	const { props } = node as { props: Props };
	return [props, ...elements(props.children)];
}

function tap(tree: unknown, match: (props: Props) => boolean): void {
	const [target, ...others] = elements(tree).filter(match);
	assert.ok(target && others.length === 0, 'exactly one control matches');
	(target.onClick as (event: { preventDefault: () => void }) => void)({ preventDefault: () => {} });
}

const shareButton = (props: Props) => props['aria-describedby'] === 'share-status-live';
const copyButton = (props: Props) => props['aria-label'] === 'copyLink';
const whatsappLink = (props: Props) => props['aria-label'] === 'opensInNewTab';
const flatButton = (props: Props) => [props.children].flat().includes('toFlat');
const retryButton = (props: Props) => props.children === 'tryAgain';

beforeEach(() => {
	slots = [];
	effects = [];
	captured.length = 0;
	skips = 0;
	Object.assign(reply, { created: true, share: 'shared', copied: true });
});

test('the step is reported as shown once, when its invite link is ready', async () => {
	reply.created = false;
	const failed = await ready();
	assert.deepEqual(captured, [], 'a link that failed to load was never shown');

	reply.created = true;
	tap(failed, retryButton);
	await ready();
	await render();
	assert.deepEqual(captured, [{ event: 'invite_step_shown' }]);
});

test('each way of handing the link on reports its method and nothing else', async () => {
	const tree = await ready();
	tap(tree, shareButton);
	await settle();
	reply.share = 'copied'; // no share sheet: the share button copied the text instead
	tap(tree, shareButton);
	await settle();
	tap(tree, copyButton);
	await settle();
	tap(tree, whatsappLink);

	assert.deepEqual(captured, [
		{ event: 'invite_step_shown' },
		{ event: 'invite_step_shared', properties: { method: 'share' } },
		{ event: 'invite_step_shared', properties: { method: 'copy' } },
		{ event: 'invite_step_shared', properties: { method: 'copy' } },
		{ event: 'invite_step_shared', properties: { method: 'whatsapp' } },
	]);
});

test('a cancelled or failed share sends nothing, so going to the flat is a skip', async () => {
	const loading = await render();
	tap(loading, whatsappLink); // blocked until the link exists
	const tree = await render();
	reply.share = 'cancelled';
	tap(tree, shareButton);
	await settle();
	reply.share = 'failed';
	tap(tree, shareButton);
	await settle();
	reply.copied = false;
	tap(tree, copyButton);
	await settle();
	tap(tree, flatButton);

	assert.deepEqual(captured, [{ event: 'invite_step_shown' }, { event: 'invite_step_skipped' }]);
	assert.equal(skips, 1);
});

test('going to the flat after a share is not a skip', async () => {
	const tree = await ready();
	tap(tree, whatsappLink);
	tap(tree, flatButton);

	assert.deepEqual(
		captured.map(({ event }) => event),
		['invite_step_shown', 'invite_step_shared'],
	);
	assert.equal(skips, 1);
});
