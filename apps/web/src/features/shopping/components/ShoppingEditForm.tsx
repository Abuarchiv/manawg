import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { NAME_MAX, QUANTITY_MAX } from '@/features/shopping/components/constants';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import type { ShoppingEditResult } from '@/features/shopping/hooks/use-shopping-edit';
import {
	type ShoppingEditFields,
	useShoppingEditForm,
} from '@/features/shopping/hooks/use-shopping-edit-form';
import { useMessage } from '@/shared/i18n/message';

interface ShoppingEditFormProps {
	item: ShoppingItem;
	onSave: (base: ShoppingItem, fields: ShoppingEditFields) => Promise<ShoppingEditResult>;
	onDone: () => void;
}

/** Name and amount of one item, shown inside the item's action drawer. */
export function ShoppingEditForm({ item, onSave, onDone }: ShoppingEditFormProps) {
	const t = useTranslations('shopping.editForm');
	const render = useMessage();
	const { name, setName, quantity, setQuantity, saving, error, submit } = useShoppingEditForm(
		item,
		onSave,
		onDone,
	);
	const nameRef = useRef<HTMLInputElement>(null);
	const idBase = `shopping-edit-${item.id}`;

	// The trigger button is gone once the form opens: move focus into the form.
	useEffect(() => {
		nameRef.current?.focus();
	}, []);

	return (
		<form
			className="flex flex-col gap-3"
			aria-busy={saving}
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${idBase}-name`}>{t('name')}</Label>
				<Input
					ref={nameRef}
					id={`${idBase}-name`}
					value={name}
					onChange={(event) => setName(event.target.value)}
					maxLength={NAME_MAX}
					disabled={saving}
					enterKeyHint="next"
					required
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${idBase}-quantity`}>{t('quantity')}</Label>
				<Input
					id={`${idBase}-quantity`}
					value={quantity}
					onChange={(event) => setQuantity(event.target.value)}
					maxLength={QUANTITY_MAX}
					disabled={saving}
					enterKeyHint="done"
				/>
			</div>
			{error && (
				<Alert variant="destructive">
					<AlertDescription>{render(error)}</AlertDescription>
				</Alert>
			)}
			<div className="flex gap-2">
				<Button type="submit" disabled={saving || name.trim().length === 0}>
					{saving && <Spinner data-icon="inline-start" aria-hidden />}
					{saving ? t('saving') : t('save')}
				</Button>
				<Button type="button" variant="outline" onClick={onDone} disabled={saving}>
					{t('cancel')}
				</Button>
			</div>
		</form>
	);
}
