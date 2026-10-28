'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
	Drawer,
	DrawerContent,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/components/ui/drawer';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/Toast';
import { mutationError } from '@/core/http/error-codes';
import {
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import {
	INVENTORY_CATEGORIES,
	INVENTORY_UNITS,
	type InventoryCategory,
	type InventoryItemDto,
	type InventoryMutationItemDto,
	type InventoryUnit,
	normalizeForMatch,
	parseQuantityText,
	quantityInputText,
} from '@/features/inventory/inventory';
import { useQuantityText } from '@/features/inventory/use-quantity-text';
import type { Locale } from '@/shared/i18n/locale';
import { type Message, useMessage } from '@/shared/i18n/message';
import { InventoryFormFields } from './InventoryFormFields';

interface InventoryFormDrawerProps {
	open: boolean;
	shareCode: string;
	memberId: string;
	mode: 'create' | 'edit';
	initial?: {
		id: string;
		name: string;
		quantity: number;
		unit: string;
		threshold: number;
		category: string;
		updatedAt: string;
	} | null;
	/** Existing items, for the duplicate-name hint (the server enforces it too). */
	items: InventoryItemDto[];
	onClose: () => void;
	onSaved: (item?: InventoryMutationItemDto, deletedId?: string) => void;
	onItemRefreshed: (item: InventoryItemDto) => void;
}

type InventoryEditorItem = NonNullable<InventoryFormDrawerProps['initial']>;

const SAVE_SUBJECT: Message = { key: 'inventory.save.subject' };
const SAVE_FALLBACK: Message = { key: 'inventory.save.fallback' };

const DEFAULT_UNIT: InventoryUnit = 'Stück'; // i18n-ignore stored unit key
const DEFAULT_CATEGORY: InventoryCategory = 'sonstiges';

function coerceUnit(unit: string | undefined): InventoryUnit {
	if (unit && (INVENTORY_UNITS as readonly string[]).includes(unit)) {
		return unit as InventoryUnit;
	}
	return DEFAULT_UNIT;
}

function coerceCategory(category: string | undefined): InventoryCategory {
	if (category && (INVENTORY_CATEGORIES as readonly string[]).includes(category)) {
		return category as InventoryCategory;
	}
	return DEFAULT_CATEGORY;
}

export function InventoryFormDrawer({
	open,
	shareCode,
	memberId,
	mode,
	initial,
	items,
	onClose,
	onSaved,
	onItemRefreshed,
}: InventoryFormDrawerProps) {
	const t = useTranslations('inventory.form');
	const render = useMessage();
	const quantityLabel = useQuantityText();
	const locale = useLocale() as Locale;
	const toast = useToast();
	const encodedShareCode = encodeURIComponent(shareCode);
	const [name, setName] = useState('');
	const [quantityText, setQuantityText] = useState('0');
	const [unit, setUnit] = useState<InventoryUnit>(DEFAULT_UNIT);
	const [thresholdText, setThresholdText] = useState('1');
	const [category, setCategory] = useState<InventoryCategory>(DEFAULT_CATEGORY);
	const [baseline, setBaseline] = useState<InventoryEditorItem | null>(initial ?? null);
	const [saving, setSaving] = useState(false);
	const [conflictNeedsReload, setConflictNeedsReload] = useState(false);
	const [discardOpen, setDiscardOpen] = useState(false);
	const [nameError, setNameError] = useState<Message | null>(null);
	const [serverError, setServerError] = useState<Message | null>(null);
	const alertRef = useRef<HTMLDivElement>(null);
	const createRequestRef = useRef<PendingIdempotentRequest | null>(null);
	const quantity = parseQuantityText(quantityText);
	const threshold = parseQuantityText(thresholdText);
	const initialRef = useRef(initial);

	useEffect(() => {
		initialRef.current = initial;
	}, [initial]);

	useEffect(() => {
		if (!open) return;
		const current = initialRef.current ?? null;
		setBaseline(current);
		setName(current?.name ?? '');
		setQuantityText(quantityInputText(current?.quantity ?? 0, locale));
		setUnit(coerceUnit(current?.unit));
		setThresholdText(quantityInputText(current?.threshold ?? 1, locale));
		setCategory(coerceCategory(current?.category));
		setConflictNeedsReload(false);
		setNameError(null);
		setServerError(null);
	}, [open, locale]);

	// The error sits outside the scrolling area; focus it so keyboard and screen-reader users find it.
	useEffect(() => {
		if (serverError) alertRef.current?.focus({ preventScroll: true });
	}, [serverError]);

	function requestClose(): void {
		if (saving) return;
		const current = baseline ?? initial;
		const dirty =
			name !== (current?.name ?? '') ||
			quantity !== (current?.quantity ?? 0) ||
			unit !== coerceUnit(current?.unit) ||
			threshold !== (current?.threshold ?? 1) ||
			category !== coerceCategory(current?.category);
		if (dirty) setDiscardOpen(true);
		else onClose();
	}

	async function save(): Promise<void> {
		if (saving) return;
		const trimmedName = name.trim();
		if (trimmedName.length === 0) {
			setNameError({ key: 'inventory.save.nameRequired' });
			setServerError(null);
			return;
		}
		const current = baseline ?? initial;
		// An edit that keeps its own name is never flagged, so old duplicates stay editable.
		const key = normalizeForMatch(trimmedName);
		const duplicate =
			(mode === 'create' || key !== normalizeForMatch(current?.name ?? '')) &&
			items.find((other) => other.id !== current?.id && normalizeForMatch(other.name) === key);
		if (duplicate) {
			setNameError({
				key: 'inventory.save.exists',
				values: {
					name: duplicate.name,
					quantity: quantityLabel(duplicate.quantity, duplicate.unit),
				},
			});
			setServerError(null);
			return;
		}
		// An edit sends only the fields that changed, so it never resets one a housemate saved
		// meanwhile. A name/threshold-only edit must not carry the version check either: it
		// would 409 whenever a housemate tapped +/- since the form was opened.
		const edited = mode === 'edit' ? current : null;
		const quantityChanged = !edited || quantity !== edited.quantity;
		const body = {
			...(!edited || trimmedName !== edited.name ? { name: trimmedName } : {}),
			...(!edited || unit !== coerceUnit(edited.unit) ? { unit } : {}),
			...(!edited || threshold !== edited.threshold ? { threshold } : {}),
			...(!edited || category !== coerceCategory(edited.category) ? { category } : {}),
			...(quantityChanged ? { quantity } : {}),
			...(edited && quantityChanged
				? { expectedQuantity: edited.quantity, expectedUpdatedAt: edited.updatedAt }
				: {}),
		};
		if (edited && Object.keys(body).length === 0) {
			onClose();
			return;
		}
		setSaving(true);
		setNameError(null);
		setServerError(null);
		const fingerprint = JSON.stringify(body);
		const idempotencyKey =
			mode === 'create' ? resolveIdempotencyKey(createRequestRef.current, fingerprint) : null;
		if (mode === 'create' && !idempotencyKey) {
			setSaving(false);
			setServerError({ key: 'inventory.save.keyUnavailable' });
			return;
		}
		if (idempotencyKey) createRequestRef.current = { fingerprint, key: idempotencyKey };
		const res =
			mode === 'edit' && current
				? await apiFetch<{ item: InventoryMutationItemDto }>(
						`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(current.id)}`,
						{ method: 'PATCH', memberId, body: JSON.stringify(body) },
					)
				: await apiFetch<{ item: InventoryMutationItemDto }>(
						`/api/wg/${encodedShareCode}/inventory`,
						{
							method: 'POST',
							memberId,
							headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
							body: JSON.stringify(body),
						},
					);
		if (res.ok) {
			setSaving(false);
			if (mode === 'create') createRequestRef.current = null;
			onSaved(res.data.item);
			toast.success(
				render({ key: mode === 'edit' ? 'inventory.save.updated' : 'inventory.save.saved' }),
			);
			onClose();
		} else if (mode === 'edit' && current && res.status === 404 && res.error === 'item_not_found') {
			setSaving(false);
			onSaved(undefined, current.id);
			setConflictNeedsReload(true);
			setServerError({ key: 'inventory.save.removedMeanwhile' });
		} else if (res.error === 'inventory_item_duplicate') {
			setSaving(false);
			if (mode === 'create') createRequestRef.current = null;
			setNameError({ key: 'inventory.save.existsServer' });
		} else if (mode === 'edit' && current && res.error === 'version_conflict') {
			const refreshed = await apiFetch<{ items: InventoryItemDto[] }>(
				`/api/wg/${encodedShareCode}/inventory`,
				{ memberId },
			);
			setSaving(false);
			const latest = refreshed.ok
				? (refreshed.data.items.find((item) => item.id === current.id) ?? null)
				: null;
			if (!latest) {
				onSaved(undefined, refreshed.ok ? current.id : undefined);
				setConflictNeedsReload(true);
				setServerError({ key: 'inventory.save.reloadFailed' });
				return;
			}
			onSaved(latest);
			setBaseline(latest);
			// Keep what the user typed; only untouched fields follow the server state.
			if (trimmedName === current.name) setName(latest.name);
			setQuantityText(quantityInputText(latest.quantity, locale));
			if (unit === coerceUnit(current.unit)) setUnit(coerceUnit(latest.unit));
			if (threshold === current.threshold)
				setThresholdText(quantityInputText(latest.threshold, locale));
			if (category === coerceCategory(current.category)) {
				setCategory(coerceCategory(latest.category));
			}
			setConflictNeedsReload(false);
			onItemRefreshed(latest);
			setServerError({ key: 'inventory.save.changedMeanwhile' });
		} else if (
			mode === 'create' &&
			res.status > 0 &&
			res.status < 500 &&
			res.error !== 'name_invalid'
		) {
			setSaving(false);
			if (shouldReleaseIdempotencyKey(res.status, res.error)) createRequestRef.current = null;
			setServerError(mutationError(SAVE_SUBJECT, res.error, {}, SAVE_FALLBACK));
		} else if (res.error === 'name_invalid') {
			setSaving(false);
			if (mode === 'create') createRequestRef.current = null;
			setNameError({ key: 'inventory.save.nameInvalid' });
		} else {
			setSaving(false);
			setServerError(mutationError(SAVE_SUBJECT, res.error, {}, SAVE_FALLBACK));
		}
	}

	return (
		<>
			<Drawer
				open={open}
				onOpenChange={(next) => {
					if (!next) requestClose();
				}}
			>
				<DrawerContent className="mx-auto w-full max-w-md">
					<DrawerHeader>
						<DrawerTitle>{mode === 'edit' ? t('titleEdit') : t('titleNew')}</DrawerTitle>
					</DrawerHeader>

					<form
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
						className="flex min-h-0 flex-col"
					>
						<div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
							<InventoryFormFields
								mode={mode}
								name={name}
								quantityText={quantityText}
								thresholdText={thresholdText}
								unit={unit}
								category={category}
								quantity={quantity}
								threshold={threshold}
								nameError={nameError}
								disabled={saving || conflictNeedsReload}
								onNameChange={(value) => {
									setName(value);
									if (nameError) setNameError(null);
								}}
								onQuantityTextChange={setQuantityText}
								onThresholdTextChange={setThresholdText}
								onUnitChange={setUnit}
								onCategoryChange={setCategory}
							/>
						</div>
						{serverError && (
							<div className="shrink-0 px-4 pb-3">
								<Alert
									ref={alertRef}
									id="inventory-save-error"
									variant="destructive"
									tabIndex={-1}
									className="outline-none"
								>
									<AlertDescription>{render(serverError)}</AlertDescription>
								</Alert>
							</div>
						)}
						<DrawerFooter className="border-t pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
							<Button type="submit" disabled={saving || conflictNeedsReload} aria-busy={saving}>
								{saving && <Spinner aria-hidden />}
								{saving ? t('saving') : t('save')}
							</Button>
							<Button type="button" variant="outline" onClick={requestClose}>
								{t('cancel')}
							</Button>
						</DrawerFooter>
					</form>
				</DrawerContent>
			</Drawer>
			<AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
				<AlertDialogContent className="w-[calc(100%-2rem)]">
					<AlertDialogHeader>
						<AlertDialogTitle>{t('discardTitle')}</AlertDialogTitle>
						<AlertDialogDescription>{t('discardDescription')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">{t('keepEditing')}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							className="min-h-11"
							onClick={() => {
								setDiscardOpen(false);
								onClose();
							}}
						>
							{t('discard')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
