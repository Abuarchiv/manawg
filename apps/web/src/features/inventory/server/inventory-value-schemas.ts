import 'server-only';
import { enumWithRenames } from '@/core/validators/renamed-value';
import { INVENTORY_CATEGORIES, INVENTORY_UNITS } from '@/features/inventory/inventory';

export const inventoryUnitSchema = enumWithRenames(INVENTORY_UNITS, {
	// i18n-ignore German key stored before migration 0039
	Stück: 'piece',
	L: 'litre',
	kg: 'kilogram',
	Rolle: 'roll',
	Packung: 'pack',
});

export const inventoryCategorySchema = enumWithRenames(INVENTORY_CATEGORIES, {
	bad: 'bathroom',
	kueche: 'kitchen',
	putzmittel: 'cleaning',
	sonstiges: 'other',
});
