import type { Catalog } from '../catalog';
import type de from '../de/export';

export default {
	shoppingStatus: { bought: 'bought', open: 'open' },
} satisfies Catalog<typeof de>;
