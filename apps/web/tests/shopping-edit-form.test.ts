import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// A minimal hook host: state survives across renders like in React.
const slots: unknown[] = [];
let cursor = 0;
mock.module('react', {
	namedExports: {
		useState: (initial: unknown) => {
			const i = cursor++;
			if (!(i in slots)) slots[i] = initial;
			return [
				slots[i],
				(value: unknown) => {
					slots[i] = value;
				},
			];
		},
	},
});

const { useShoppingEditForm } = await import(
	'../src/features/shopping/hooks/use-shopping-edit-form.ts'
);

const opened = {
	id: 'item-1',
	addedByMemberId: 'member-a',
	name: 'Milch',
	quantity: '1 L',
	boughtAt: null,
	boughtByMemberId: null,
	createdAt: '2026-10-01T10:00:00.000Z',
	updatedAt: '2026-10-01T10:00:00.000Z',
};

test('a save carries the item the form was opened on, not a row a poll delivered meanwhile', async () => {
	const saved: unknown[] = [];
	const onSave = async (base: unknown, fields: unknown) => {
		saved.push([base, fields]);
		return null;
	};
	const render = (item: typeof opened) => {
		cursor = 0;
		return useShoppingEditForm(item, onSave, () => {});
	};

	render(opened);
	const polled = { ...opened, quantity: '6 L', updatedAt: '2026-10-01T10:05:00.000Z' };
	const form = render(polled);
	assert.equal(form.quantity, '1 L');
	await form.submit();

	assert.deepEqual(saved, [[opened, { name: 'Milch', quantity: '1 L' }]]);
});
