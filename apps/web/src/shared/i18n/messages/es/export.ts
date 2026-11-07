import type { Catalog } from '../catalog';
import type de from '../de/export';

export default {
	shoppingStatus: { bought: 'comprado', open: 'pendiente' },
} satisfies Catalog<typeof de>;
