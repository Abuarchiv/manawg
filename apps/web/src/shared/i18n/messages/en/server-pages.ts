import type { Catalog } from '../catalog';
import type de from '../de/server-pages';

export default {
	paypalReturn: {
		title: 'PayPal connection – ManaWG',
		heading: 'PayPal connection is not available right now',
		body: 'The connection could not be completed. Open ManaWG and try again in your flat settings.',
		home: 'Go to ManaWG',
	},
} satisfies Catalog<typeof de>;
